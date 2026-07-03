"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
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
        });
        return res.json(shipments);
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
exports.router.put('/:id/status', auth_1.authenticate, auth_1.requireOperator, async (req, res) => {
    const { status } = req.body;
    const validStatuses = ['RECEIVED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
    if (!validStatuses.includes(status))
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
        return res.json(updated);
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
        return res.json({ message: 'Deleted' });
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
