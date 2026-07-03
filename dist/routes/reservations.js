"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const pushNotification_1 = require("../utils/pushNotification");
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
exports.router = (0, express_1.Router)();
// POST /api/reservations — user creates reservation
exports.router.post('/', auth_1.authenticate, async (req, res) => {
    const { tripId, userPhone, note } = req.body;
    if (!tripId || !userPhone)
        return res.status(400).json({ message: 'tripId and userPhone required' });
    try {
        const trip = await db_1.default.trip.findUnique({ where: { id: tripId } });
        if (!trip)
            return res.status(404).json({ message: 'Trip not found' });
        if (trip.status === 'COMPLETED')
            return res.status(400).json({ message: 'Trip is completed' });
        // Check if already reserved
        const existing = await db_1.default.reservation.findFirst({
            where: { tripId, userId: req.user.id, status: { not: 'REJECTED' } }
        });
        if (existing)
            return res.status(409).json({ message: 'Already reserved' });
        const user = await db_1.default.user.findUnique({ where: { id: req.user.id } });
        const reservation = await db_1.default.reservation.create({
            data: {
                tripId,
                userId: req.user.id,
                userName: user?.displayName || 'Unknown',
                userPhone,
                note: note || null,
                status: 'PENDING'
            }
        });
        // Send push to operator
        const operatorRecord = await db_1.default.user.findUnique({ where: { id: trip.operatorId } });
        if (operatorRecord?.pushToken) {
            await (0, pushNotification_1.sendPushNotification)(operatorRecord.pushToken, '🔔 Nouvelle réservation', `${user?.displayName} - ${trip.fromCity} → ${trip.toCity}`);
        }
        // Notify operator (in-app)
        await db_1.default.notification.create({
            data: {
                userId: trip.operatorId,
                type: 'RESERVATION',
                title: '🔔 Nouvelle réservation',
                message: `👤 ${user?.displayName}\n📞 ${userPhone}${note ? '\n📝 ' + note : ''}\n🚗 ${trip.fromCity} → ${trip.toCity}`,
                data: { reservationId: reservation.id, tripId }
            }
        });
        return res.status(201).json(reservation);
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
// GET /api/reservations/trip/:tripId — operator sees reservations for a trip
exports.router.get('/trip/:tripId', auth_1.authenticate, async (req, res) => {
    try {
        const trip = await db_1.default.trip.findUnique({ where: { id: req.params.tripId } });
        if (!trip)
            return res.status(404).json({ message: 'Trip not found' });
        if (req.user?.role !== 'ADMIN' && trip.operatorId !== req.user?.id)
            return res.status(403).json({ message: 'Forbidden' });
        const reservations = await db_1.default.reservation.findMany({
            where: { tripId: req.params.tripId },
            orderBy: { createdAt: 'desc' }
        });
        return res.json(reservations);
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
// GET /api/reservations/my — user sees their reservations
exports.router.get('/my', auth_1.authenticate, async (req, res) => {
    try {
        const reservations = await db_1.default.reservation.findMany({
            where: { userId: req.user.id },
            include: { trip: { select: { fromCity: true, toCity: true, departureTime: true, type: true, operatorName: true } } },
            orderBy: { createdAt: 'desc' }
        });
        return res.json(reservations);
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
// PUT /api/reservations/:id — operator accepts/rejects
exports.router.put('/:id', auth_1.authenticate, async (req, res) => {
    const { status } = req.body;
    if (!['ACCEPTED', 'REJECTED'].includes(status))
        return res.status(400).json({ message: 'Status must be ACCEPTED or REJECTED' });
    try {
        const reservation = await db_1.default.reservation.findUnique({
            where: { id: req.params.id },
            include: { trip: true }
        });
        if (!reservation)
            return res.status(404).json({ message: 'Not found' });
        if (req.user?.role !== 'ADMIN' && reservation.trip.operatorId !== req.user?.id)
            return res.status(403).json({ message: 'Forbidden' });
        await db_1.default.reservation.update({ where: { id: req.params.id }, data: { status } });
        // Decrease seats if ACCEPTED and LOUAGE
        if (status === 'ACCEPTED' && reservation.trip.type === 'LOUAGE') {
            await db_1.default.louageTrip.updateMany({
                where: { tripId: reservation.tripId },
                data: { availableSeats: { decrement: 1 } }
            });
        }
        // Send push notification to user
        const userRecord = await db_1.default.user.findUnique({ where: { id: reservation.userId } });
        if (userRecord?.pushToken) {
            await (0, pushNotification_1.sendPushNotification)(userRecord.pushToken, status === 'ACCEPTED' ? '✅ Réservation acceptée!' : '❌ Réservation refusée', `${reservation.trip.fromCity} → ${reservation.trip.toCity}`);
        }
        // Notify user (in-app)
        await db_1.default.notification.create({
            data: {
                userId: reservation.userId,
                type: 'RESERVATION_UPDATE',
                title: status === 'ACCEPTED' ? '✅ Réservation acceptée!' : '❌ Réservation refusée',
                message: `${reservation.trip.fromCity} → ${reservation.trip.toCity}\n${status === 'ACCEPTED' ? 'Le conducteur a accepté votre réservation. Il vous contactera.' : 'Le conducteur a refusé votre réservation.'}`,
                data: { reservationId: reservation.id }
            }
        });
        return res.json({ message: 'Updated' });
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
// DELETE /api/reservations/:id — user cancels pending reservation
exports.router.delete('/:id', auth_1.authenticate, async (req, res) => {
    try {
        const reservation = await db_1.default.reservation.findUnique({ where: { id: req.params.id } });
        if (!reservation)
            return res.status(404).json({ message: 'Not found' });
        if (reservation.userId !== req.user.id && req.user?.role !== 'ADMIN')
            return res.status(403).json({ message: 'Forbidden' });
        if (reservation.status !== 'PENDING')
            return res.status(400).json({ message: 'Can only cancel pending reservations' });
        await db_1.default.reservation.delete({ where: { id: req.params.id } });
        return res.json({ message: 'Cancelled' });
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
