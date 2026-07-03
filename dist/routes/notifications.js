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
exports.router.use(auth_1.authenticate);
// ─── GET /api/notifications ──────────────────────
// Admin gets all; users get their own
exports.router.get('/', async (req, res) => {
    try {
        const where = req.user.role === 'ADMIN' ? {} : { userId: req.user.id };
        const notifications = await db_1.default.notification.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 50,
        });
        return res.json(notifications);
    }
    catch (error) {
        return res.status(500).json({ message: 'Error fetching notifications' });
    }
});
// ─── GET /api/notifications/unread-count ─────────
exports.router.get('/unread-count', async (req, res) => {
    try {
        const where = { read: false };
        if (req.user.role !== 'ADMIN')
            where.userId = req.user.id;
        const count = await db_1.default.notification.count({ where });
        return res.json({ count });
    }
    catch (error) {
        return res.status(500).json({ message: 'Error counting notifications' });
    }
});
// ─── PUT /api/notifications/:id/read ────────────
exports.router.put('/:id/read', async (req, res) => {
    try {
        const notif = await db_1.default.notification.findUnique({ where: { id: req.params.id } });
        if (!notif)
            return res.status(404).json({ message: 'Notification not found' });
        if (notif.userId !== req.user.id && req.user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Forbidden' });
        }
        const updated = await db_1.default.notification.update({
            where: { id: req.params.id },
            data: { read: true },
        });
        return res.json(updated);
    }
    catch (error) {
        return res.status(500).json({ message: 'Error marking notification read' });
    }
});
// ─── PUT /api/notifications/read-all ────────────
exports.router.put('/read-all', async (req, res) => {
    try {
        const where = req.user.role === 'ADMIN' ? {} : { userId: req.user.id };
        await db_1.default.notification.updateMany({ where, data: { read: true } });
        return res.json({ message: 'All notifications marked as read' });
    }
    catch (error) {
        return res.status(500).json({ message: 'Error marking all read' });
    }
});
// ─── DELETE /api/notifications/:id ───────────────
exports.router.delete('/:id', async (req, res) => {
    try {
        const notif = await db_1.default.notification.findUnique({ where: { id: req.params.id } });
        if (!notif)
            return res.status(404).json({ message: 'Notification not found' });
        if (notif.userId !== req.user.id && req.user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Forbidden' });
        }
        await db_1.default.notification.delete({ where: { id: req.params.id } });
        return res.status(204).send();
    }
    catch (error) {
        return res.status(500).json({ message: 'Error deleting notification' });
    }
});
// ─── POST /api/notifications ─────────────────────
// Admin creates a notification to send to a user
exports.router.post('/', auth_1.requireAdmin, async (req, res) => {
    const { userId, type, title, message, data } = req.body;
    if (!userId || !title || !message) {
        return res.status(400).json({ message: 'userId, title and message are required' });
    }
    try {
        const notif = await db_1.default.notification.create({
            data: { userId, type: type || 'ADMIN_MESSAGE', title, message, data: data || {} },
        });
        return res.status(201).json(notif);
    }
    catch (error) {
        return res.status(500).json({ message: 'Error creating notification' });
    }
});
