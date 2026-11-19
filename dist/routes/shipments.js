"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const liveTracking_1 = require("../utils/liveTracking");
exports.router = (0, express_1.Router)();
function generateTrackingNumber() {
    const year = new Date().getFullYear();
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `TN-${year}-${rand}`;
}
exports.router.post('/', auth_1.authenticate, auth_1.requireOperator, async (req, res) => {
    const { senderName, senderPhone, receiverName, receiverPhone, description, fromCity, toCity, price, weight, notes, tripId } = req.body;
    if (!senderName || !senderPhone || !receiverName || !receiverPhone || !description || !fromCity || !toCity)
        return res.status(400).json({ message: 'Missing required fields' });
    try {
        let trackingNumber = generateTrackingNumber();
        while (await db_1.default.shipment.findUnique({ where: { trackingNumber } })) {
            trackingNumber = generateTrackingNumber();
        }
        const shipment = await db_1.default.shipment.create({
            data: {
                trackingNumber,
                operatorId: req.user.id,
                tripId: tripId || null,
                senderName, senderPhone,
                receiverName, receiverPhone,
                description, fromCity, toCity,
                price: price ? parseFloat(price) : null,
                weight: weight ? parseFloat(weight) : null,
                notes: notes || null,
                status: 'RECEIVED',
            },
            include: { trip: { select: { id: true, fromCity: true, toCity: true, departureTime: true } } }
        });
        return res.status(201).json(shipment);
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
exports.router.get('/track/:trackingNumber', async (req, res) => {
    try {
        const shipment = await db_1.default.shipment.findUnique({
            where: { trackingNumber: req.params.trackingNumber.toUpperCase() },
            include: { operator: { select: { displayName: true, username: true } } }
        });
        if (!shipment)
            return res.status(404).json({ message: 'Shipment not found' });
        return res.json(shipment);
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
exports.router.get('/', auth_1.authenticate, auth_1.requireOperator, async (req, res) => {
    try {
        const shipments = await db_1.default.shipment.findMany({
            where: { operatorId: req.user.id },
            orderBy: { createdAt: 'desc' },
            include: {
                trip: { select: { id: true, fromCity: true, toCity: true, departureTime: true, type: true } }
            }
        });
        return res.json(shipments);
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
const VALID_STATUSES = ['RECEIVED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
exports.router.put('/bulk-status', auth_1.authenticate, auth_1.requireOperator, async (req, res) => {
    const { tripId, status } = req.body;
    if (!status || !VALID_STATUSES.includes(status))
        return res.status(400).json({ message: 'Invalid status' });
    try {
        const where = { operatorId: req.user.id };
        if (tripId === 'no_trip') {
            where.tripId = null;
        }
        else if (tripId) {
            where.tripId = tripId;
        }
        else {
            return res.status(400).json({ message: 'Missing tripId' });
        }
        const result = await db_1.default.shipment.updateMany({ where, data: { status } });
        if (tripId !== 'no_trip')
            await (0, liveTracking_1.refreshTracking)(tripId);
        return res.json({ updated: result.count });
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
exports.router.put('/:id/status', auth_1.authenticate, auth_1.requireOperator, async (req, res) => {
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status))
        return res.status(400).json({ message: 'Invalid status' });
    try {
        const shipment = await db_1.default.shipment.findUnique({ where: { id: req.params.id } });
        if (!shipment)
            return res.status(404).json({ message: 'Shipment not found' });
        if (shipment.operatorId !== req.user.id)
            return res.status(403).json({ message: 'Forbidden' });
        const updated = await db_1.default.shipment.update({
            where: { id: req.params.id },
            data: { status }
        });
        await (0, liveTracking_1.refreshTracking)(shipment.tripId);
        return res.json(updated);
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
exports.router.put('/:id', auth_1.authenticate, auth_1.requireOperator, async (req, res) => {
    const { senderName, senderPhone, receiverName, receiverPhone, description, fromCity, toCity, price, weight, notes, tripId } = req.body;
    try {
        const shipment = await db_1.default.shipment.findUnique({ where: { id: req.params.id } });
        if (!shipment)
            return res.status(404).json({ message: 'Shipment not found' });
        if (shipment.operatorId !== req.user.id)
            return res.status(403).json({ message: 'Forbidden' });
        const updated = await db_1.default.shipment.update({
            where: { id: req.params.id },
            data: {
                senderName: senderName ?? shipment.senderName,
                senderPhone: senderPhone ?? shipment.senderPhone,
                receiverName: receiverName ?? shipment.receiverName,
                receiverPhone: receiverPhone ?? shipment.receiverPhone,
                description: description ?? shipment.description,
                fromCity: fromCity ?? shipment.fromCity,
                toCity: toCity ?? shipment.toCity,
                price: price !== undefined ? (price ? parseFloat(price) : null) : shipment.price,
                weight: weight !== undefined ? (weight ? parseFloat(weight) : null) : shipment.weight,
                notes: notes !== undefined ? notes : shipment.notes,
                tripId: tripId !== undefined ? (tripId || null) : shipment.tripId,
            },
            include: { trip: { select: { id: true, fromCity: true, toCity: true, departureTime: true } } }
        });
        if (updated.tripId !== shipment.tripId) {
            await (0, liveTracking_1.refreshTracking)(shipment.tripId);
            await (0, liveTracking_1.refreshTracking)(updated.tripId);
        }
        return res.json(updated);
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
exports.router.delete('/bulk', auth_1.authenticate, auth_1.requireOperator, async (req, res) => {
    try {
        const result = await db_1.default.shipment.deleteMany({
            where: { operatorId: req.user.id, status: { in: ['DELIVERED', 'CANCELLED'] } }
        });
        return res.json({ deleted: result.count });
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
exports.router.delete('/:id', auth_1.authenticate, auth_1.requireOperator, async (req, res) => {
    try {
        const shipment = await db_1.default.shipment.findUnique({ where: { id: req.params.id } });
        if (!shipment)
            return res.status(404).json({ message: 'Shipment not found' });
        if (shipment.operatorId !== req.user.id)
            return res.status(403).json({ message: 'Forbidden' });
        await db_1.default.shipment.delete({ where: { id: req.params.id } });
        await (0, liveTracking_1.refreshTracking)(shipment.tripId);
        return res.json({ message: 'Deleted' });
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
