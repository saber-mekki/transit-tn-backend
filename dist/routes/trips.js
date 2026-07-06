"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const client_1 = require("@prisma/client");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
exports.router = (0, express_1.Router)();
const INCLUDE_ALL = {
    louageTrip: { include: { station: true } },
    busTrip: { include: { departureStation: true, arrivalStation: true } },
    transporterTrip: true,
    ratings: { select: { score: true } },
    operator: { select: { id: true, displayName: true, operatorRatings: { select: { score: true } } } },
};
function formatTrip(trip) {
    if (!trip)
        return null;
    const { louageTrip, busTrip, transporterTrip, ...base } = trip;
    let extra = {};
    if (trip.type === 'LOUAGE' && louageTrip)
        extra = louageTrip;
    else if (trip.type === 'BUS' && busTrip)
        extra = busTrip;
    else if (trip.type === 'TRANSPORTER' && transporterTrip)
        extra = transporterTrip;
    // IMPORTANT: preserve base trip id, not sub-table id
    const { id: _subId, ...extraWithoutId } = extra;
    return { ...base, type: base.type.toLowerCase(), ...extraWithoutId };
}
// ─── GET /api/trips ──────────────────────────────
exports.router.get('/', async (req, res) => {
    const { type, fromCity, toCity, operatorId, minPrice, maxPrice, minSeats, date, sortBy, limit, offset } = req.query;
    const take = parseInt(limit) || 20;
    const skip = parseInt(offset) || 0;
    const where = { status: { not: 'COMPLETED' } };
    if (type)
        where.type = type.toUpperCase();
    if (operatorId)
        where.operatorId = operatorId;
    // Price filter (applied on sub-tables via join)
    // Seats filter
    if (minSeats) {
        where.OR = where.OR || [];
        // filter done post-query for seats since it's in sub-table
    }
    // Date filter
    if (date) {
        const d = new Date(date);
        const nextDay = new Date(d);
        nextDay.setDate(nextDay.getDate() + 1);
        // Override the OR to also include date filter
        where.AND = [
            {
                OR: [
                    { departureTime: { gte: new Date() } },
                    { departureTime: { gte: new Date('2099-01-01') } },
                    { type: 'BUS' },
                ]
            },
            {
                OR: [
                    { departureTime: { gte: d, lt: nextDay } },
                    { departureTime: { gte: new Date('2099-01-01') } },
                ]
            }
        ];
        delete where.OR;
    }
    // Exclude expired trips but keep: bus trips, 2099 demo trips, future trips
    const now = new Date();
    where.OR = [
        { departureTime: { gte: now } }, // future trips
        { departureTime: { gte: new Date('2099-01-01') } }, // 2099 demo
        { type: 'BUS' }, // all bus trips always visible
    ];
    if (req.query.direction === 'tn-to-intl') {
        // fromCity is Tunisia (no comma = Tunisia city)
        where.fromCity = { not: { contains: ',' } };
    }
    if (req.query.direction === 'intl-to-tn') {
        // fromCity contains comma = international
        where.fromCity = { contains: ',' };
    }
    if (fromCity)
        where.fromCity = { contains: fromCity, mode: 'insensitive' };
    if (toCity)
        where.toCity = { contains: toCity, mode: 'insensitive' };
    try {
        const sortByVal = sortBy || 'time';
        const orderByClause = sortByVal === 'time' ? { departureTime: 'asc' } : { createdAt: 'asc' };
        const [trips, total] = await Promise.all([
            db_1.default.trip.findMany({ where, include: INCLUDE_ALL, orderBy: orderByClause, take, skip }),
            db_1.default.trip.count({ where })
        ]);
        let formatted = trips.map(formatTrip);
        if (minPrice)
            formatted = formatted.filter((t) => !t.price || t.price >= parseFloat(minPrice));
        if (maxPrice)
            formatted = formatted.filter((t) => !t.price || t.price <= parseFloat(maxPrice));
        if (minSeats)
            formatted = formatted.filter((t) => t.availableSeats == null || t.availableSeats >= parseInt(minSeats));
        if (sortByVal === 'price')
            formatted.sort((a, b) => (a.price || 0) - (b.price || 0));
        if (sortByVal === 'seats')
            formatted.sort((a, b) => (b.availableSeats || 0) - (a.availableSeats || 0));
        return res.json({ trips: formatted, total, hasMore: skip + take < total });
    }
    catch (error) {
        return res.status(500).json({ message: 'Error fetching trips' });
    }
});
// ─── GET /api/trips/:id ──────────────────────────
// ─── GET /api/trips/history ───────────────────────
exports.router.get('/history', auth_1.authenticate, async (req, res) => {
    try {
        const where = req.user?.role === 'ADMIN'
            ? { status: 'COMPLETED' }
            : { status: 'COMPLETED', operatorId: req.user?.id };
        const trips = await db_1.default.trip.findMany({
            where,
            include: {
                ...INCLUDE_ALL,
                operator: { select: { displayName: true, email: true } },
                ratings: true
            },
            orderBy: { completedAt: 'desc' },
            take: 100
        });
        return res.json(trips);
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
exports.router.get('/:id', async (req, res) => {
    try {
        const trip = await db_1.default.trip.findUnique({ where: { id: req.params.id }, include: INCLUDE_ALL });
        if (!trip)
            return res.status(404).json({ message: 'Trip not found' });
        return res.json(formatTrip(trip));
    }
    catch (error) {
        return res.status(500).json({ message: 'Error fetching trip' });
    }
});
// ─── POST /api/trips ─────────────────────────────
exports.router.post('/', auth_1.authenticate, auth_1.requireOperator, async (req, res) => {
    const { type, fromCity, toCity, departureTime, arrivalTime, ...details } = req.body;
    if (!type || !fromCity || !toCity || !departureTime) {
        return res.status(400).json({ message: 'type, fromCity, toCity, departureTime are required' });
    }
    try {
        const operatorId = req.user.id;
        const operator = await db_1.default.user.findUnique({ where: { id: operatorId } });
        if (!operator)
            return res.status(404).json({ message: 'Operator not found' });
        const tripType = type.toUpperCase();
        const dt = new Date(departureTime);
        const at = arrivalTime ? new Date(arrivalTime) : dt;
        let newTrip;
        if (tripType === client_1.TransportType.LOUAGE) {
            const { price, totalSeats, customStationName, vehicleNumber, contactInfo } = details;
            newTrip = await db_1.default.trip.create({
                data: {
                    type: client_1.TransportType.LOUAGE, operatorId, operatorName: operator.displayName,
                    fromCity, toCity, departureTime: dt, arrivalTime: at,
                    louageTrip: { create: {
                            price: Number(price) || 0, totalSeats: Number(totalSeats) || 8,
                            availableSeats: Number(totalSeats) || 8, isFull: false,
                            customStationName: customStationName || null,
                            vehicleNumber: vehicleNumber || null,
                            contactInfo: contactInfo || null,
                        } },
                }, include: INCLUDE_ALL,
            });
        }
        else if (tripType === client_1.TransportType.BUS) {
            const { price, totalSeats, customStationName } = details;
            newTrip = await db_1.default.trip.create({
                data: {
                    type: client_1.TransportType.BUS, operatorId, operatorName: operator.displayName,
                    fromCity, toCity, departureTime: dt, arrivalTime: at,
                    busTrip: { create: {
                            price: Number(price) || 0, totalSeats: Number(totalSeats) || 8,
                            availableSeats: Number(totalSeats) || 8,
                            customDepartureStationName: customStationName || null,
                        } },
                }, include: INCLUDE_ALL,
            });
        }
        else if (tripType === client_1.TransportType.TRANSPORTER) {
            const { contactInfo, vehicleType, availableSpace, eta, route } = details;
            newTrip = await db_1.default.trip.create({
                data: {
                    type: client_1.TransportType.TRANSPORTER, operatorId, operatorName: operator.displayName,
                    fromCity, toCity, departureTime: dt, arrivalTime: at,
                    transporterTrip: { create: {
                            contactInfo: contactInfo || '', vehicleType: vehicleType || '',
                            availableSpace: availableSpace || '', eta: eta || '',
                            route: route || [],
                        } },
                }, include: INCLUDE_ALL,
            });
        }
        else {
            return res.status(400).json({ message: 'Invalid trip type' });
        }
        return res.status(201).json(formatTrip(newTrip));
    }
    catch (error) {
        console.error('POST trip error:', error.message);
        return res.status(500).json({ message: error.message || 'Error creating trip' });
    }
});
// ─── PUT /api/trips/:id ──────────────────────────
exports.router.put('/:id', auth_1.authenticate, auth_1.requireOperator, async (req, res) => {
    const { id } = req.params;
    try {
        // IMPORTANT: include INCLUDE_ALL to get type-specific sub-tables
        const trip = await db_1.default.trip.findUnique({ where: { id }, include: INCLUDE_ALL });
        if (!trip)
            return res.status(404).json({ message: 'Trip not found' });
        if (req.user.role !== 'ADMIN' && trip.operatorId !== req.user.id) {
            return res.status(403).json({ message: 'You can only edit your own trips' });
        }
        const { fromCity, toCity, departureTime, arrivalTime, availableSeats, isFull, price, totalSeats, customStationName, vehicleNumber, contactInfo, vehicleType, availableSpace, eta, } = req.body;
        const baseUpdate = {};
        if (fromCity)
            baseUpdate.fromCity = fromCity;
        if (toCity)
            baseUpdate.toCity = toCity;
        if (departureTime)
            baseUpdate.departureTime = new Date(departureTime);
        if (arrivalTime)
            baseUpdate.arrivalTime = new Date(arrivalTime);
        if (trip.type === 'LOUAGE') {
            const lu = {};
            if (price !== undefined)
                lu.price = Number(price);
            if (totalSeats !== undefined)
                lu.totalSeats = Number(totalSeats);
            if (availableSeats !== undefined)
                lu.availableSeats = Number(availableSeats);
            if (availableSeats !== undefined)
                lu.isFull = Number(availableSeats) === 0;
            if (isFull !== undefined && availableSeats === undefined)
                lu.isFull = Boolean(isFull);
            if (customStationName !== undefined)
                lu.customStationName = customStationName;
            if (vehicleNumber !== undefined)
                lu.vehicleNumber = vehicleNumber;
            if (contactInfo !== undefined)
                lu.contactInfo = contactInfo;
            if (Object.keys(lu).length > 0)
                baseUpdate.louageTrip = { update: lu };
        }
        else if (trip.type === 'BUS') {
            const bu = {};
            if (price !== undefined)
                bu.price = Number(price);
            if (totalSeats !== undefined)
                bu.totalSeats = Number(totalSeats);
            if (availableSeats !== undefined)
                bu.availableSeats = Number(availableSeats);
            if (customStationName !== undefined)
                bu.customDepartureStationName = customStationName;
            if (Object.keys(bu).length > 0)
                baseUpdate.busTrip = { update: bu };
        }
        else if (trip.type === 'TRANSPORTER') {
            const tu = {};
            if (contactInfo !== undefined)
                tu.contactInfo = contactInfo;
            if (vehicleType !== undefined)
                tu.vehicleType = vehicleType;
            if (availableSpace !== undefined)
                tu.availableSpace = availableSpace;
            if (eta !== undefined)
                tu.eta = eta;
            if (req.body.route !== undefined)
                tu.route = req.body.route;
            if (Object.keys(tu).length > 0)
                baseUpdate.transporterTrip = { update: tu };
        }
        const updated = await db_1.default.trip.update({ where: { id }, data: baseUpdate, include: INCLUDE_ALL });
        return res.json(formatTrip(updated));
    }
    catch (error) {
        console.error('PUT trip error:', error.message);
        return res.status(500).json({ message: error.message || 'Error updating trip' });
    }
});
// ─── DELETE /api/trips/:id ───────────────────────
exports.router.delete('/:id', auth_1.authenticate, auth_1.requireOperator, async (req, res) => {
    const { id } = req.params;
    try {
        const trip = await db_1.default.trip.findUnique({ where: { id } });
        if (!trip)
            return res.status(404).json({ message: 'Trip not found' });
        if (req.user.role !== 'ADMIN' && trip.operatorId !== req.user.id) {
            return res.status(403).json({ message: 'You can only delete your own trips' });
        }
        await db_1.default.trip.delete({ where: { id } });
        return res.status(204).send();
    }
    catch (error) {
        return res.status(500).json({ message: error.message || 'Error deleting trip' });
    }
});
// ─── PUT /api/trips/:id/complete ─────────────────
exports.router.put('/:id/complete', auth_1.authenticate, async (req, res) => {
    try {
        const trip = await db_1.default.trip.findUnique({ where: { id: req.params.id } });
        if (!trip)
            return res.status(404).json({ message: 'Trip not found' });
        if (req.user?.role !== 'ADMIN' && trip.operatorId !== req.user?.id)
            return res.status(403).json({ message: 'Forbidden' });
        const updated = await db_1.default.trip.update({
            where: { id: req.params.id },
            data: { status: 'COMPLETED', completedAt: new Date() }
        });
        // Auto-update linked shipments to IN_TRANSIT
        await db_1.default.shipment.updateMany({
            where: { tripId: req.params.id, status: 'RECEIVED' },
            data: { status: 'IN_TRANSIT' }
        });
        return res.json(updated);
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
// ─── POST /api/trips/:id/rate ─────────────────────
exports.router.post('/:id/rate', auth_1.authenticate, async (req, res) => {
    const { score, comment } = req.body;
    if (!score || score < 1 || score > 5)
        return res.status(400).json({ message: 'Score must be 1-5' });
    try {
        const trip = await db_1.default.trip.findUnique({ where: { id: req.params.id } });
        if (!trip)
            return res.status(404).json({ message: 'Trip not found' });
        // Rating allowed for all trips regardless of status
        const existing = await db_1.default.rating.findFirst({
            where: { tripId: req.params.id, userId: req.user.id }
        });
        if (existing)
            return res.status(409).json({ message: 'Already rated' });
        const rating = await db_1.default.rating.create({
            data: { tripId: req.params.id, userId: req.user.id, score, comment: comment || null }
        });
        return res.status(201).json(rating);
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
// ─── GET /api/trips/:id/ratings ──────────────────
exports.router.get('/:id/ratings', async (req, res) => {
    try {
        const ratings = await db_1.default.rating.findMany({
            where: { tripId: req.params.id },
            orderBy: { createdAt: 'desc' }
        });
        const avg = ratings.length ? (ratings.reduce((a, r) => a + r.score, 0) / ratings.length).toFixed(1) : null;
        return res.json({ ratings, avg, count: ratings.length });
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
// pagination fix lun. 06 juil. 2026 19:59:47 CEST
