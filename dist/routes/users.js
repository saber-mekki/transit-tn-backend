"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const client_1 = require("@prisma/client");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
exports.router = (0, express_1.Router)();
// All user routes require auth
exports.router.use(auth_1.authenticate);
// ─── GET /api/users ──────────────────────────────
// Admin only: list all users
exports.router.get('/', auth_1.requireAdmin, async (req, res) => {
    try {
        const users = await db_1.default.user.findMany({
            select: { id: true, username: true, displayName: true, role: true, email: true, phone: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
        });
        return res.json(users);
    }
    catch (error) {
        return res.status(500).json({ message: 'Error fetching users' });
    }
});
// ─── GET /api/users/:id ──────────────────────────
exports.router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const user = await db_1.default.user.findUnique({
            where: { id },
            select: { id: true, username: true, displayName: true, role: true, phone: true, bio: true, createdAt: true },
        });
        if (!user)
            return res.status(404).json({ message: 'User not found' });
        // Only return public info for operators, full info for own profile/admin
        if (req.user?.role === 'ADMIN' || req.user?.id === id) {
            const full = await db_1.default.user.findUnique({
                where: { id },
                select: { id: true, username: true, displayName: true, role: true, email: true, phone: true, bio: true, createdAt: true },
            });
            return res.json(full);
        }
        return res.json(user);
    }
    catch (error) {
        return res.status(500).json({ message: 'Error fetching user' });
    }
});
// ─── PUT /api/users/:id ──────────────────────────
// Admin: change role. User: update own profile
exports.router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const isAdmin = req.user.role === 'ADMIN';
    const isSelf = req.user.id === id;
    if (!isAdmin && !isSelf)
        return res.status(403).json({ message: 'Forbidden' });
    const { role, displayName, email, phone } = req.body;
    try {
        const updateData = {};
        // Only admin can change roles
        if (role && isAdmin) {
            if (!Object.values(client_1.UserRole).includes(role.toUpperCase())) {
                return res.status(400).json({ message: 'Invalid role' });
            }
            updateData.role = role.toUpperCase();
        }
        if (displayName)
            updateData.displayName = displayName;
        if (email !== undefined)
            updateData.email = email;
        if (phone !== undefined)
            updateData.phone = phone;
        const updated = await db_1.default.user.update({
            where: { id },
            data: updateData,
            select: { id: true, username: true, displayName: true, role: true, email: true, phone: true },
        });
        return res.json(updated);
    }
    catch (error) {
        return res.status(500).json({ message: 'Error updating user' });
    }
});
// ─── DELETE /api/users/:id ───────────────────────
exports.router.delete('/:id', auth_1.requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const user = await db_1.default.user.findUnique({ where: { id } });
        if (!user)
            return res.status(404).json({ message: 'User not found' });
        if (user.username === 'admin') {
            return res.status(403).json({ message: 'Cannot delete the primary admin account' });
        }
        if (req.user.id === id) {
            return res.status(403).json({ message: 'Cannot delete your own account' });
        }
        await db_1.default.user.delete({ where: { id } });
        return res.status(204).send();
    }
    catch (error) {
        return res.status(500).json({ message: 'Error deleting user' });
    }
});
// ─── POST /api/users ─────────────────────────────
// Admin creates a user directly
exports.router.post('/', auth_1.requireAdmin, async (req, res) => {
    const { username, password, displayName, role, email, phone } = req.body;
    if (!username || !password || !displayName || !role) {
        return res.status(400).json({ message: 'username, password, displayName and role are required' });
    }
    try {
        const existing = await db_1.default.user.findUnique({ where: { username } });
        if (existing)
            return res.status(409).json({ message: 'Username already taken' });
        const hashed = await bcryptjs_1.default.hash(password, 12);
        const user = await db_1.default.user.create({
            data: { username, password: hashed, displayName, role: role.toUpperCase(), email: email || null, phone: phone || null },
            select: { id: true, username: true, displayName: true, role: true, email: true, phone: true, createdAt: true },
        });
        return res.status(201).json(user);
    }
    catch (error) {
        return res.status(500).json({ message: 'Error creating user' });
    }
});
