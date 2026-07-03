"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
exports.router = (0, express_1.Router)();
// ─── POST /api/auth/signup ───────────────────────
exports.router.post('/signup', async (req, res) => {
    const { password, displayName, role, email, phone } = req.body;
    if (!email || !password || !displayName || !role) {
        return res.status(400).json({ message: 'email, password, displayName and role are required' });
    }
    if (password.length < 8) {
        return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }
    const validRoles = ['USER', 'OPERATOR'];
    if (!validRoles.includes(role.toUpperCase())) {
        return res.status(400).json({ message: 'Role must be USER or OPERATOR' });
    }
    try {
        const emailTaken = await db_1.default.user.findUnique({ where: { email } });
        if (emailTaken)
            return res.status(409).json({ message: 'Email already in use' });
        // Auto-generate username from email
        const baseUsername = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        let username = baseUsername;
        let count = 1;
        while (await db_1.default.user.findUnique({ where: { username } })) {
            username = `${baseUsername}${count++}`;
        }
        const hashed = await bcryptjs_1.default.hash(password, 12);
        const user = await db_1.default.user.create({
            data: { username, password: hashed, displayName, role: role.toUpperCase(), email, phone: phone || null },
            select: { id: true, username: true, displayName: true, role: true, email: true, phone: true, bio: true, createdAt: true },
        });
        // Notify all admins
        const admins = await db_1.default.user.findMany({ where: { role: 'ADMIN' } });
        const roleLabel = user.role === 'OPERATOR' ? '🚗 Driver / Operator' : '👤 Passenger';
        const details = [
            `👤 Name: ${user.displayName}`,
            `📧 Email: ${user.email}`,
            `🎭 Role: ${roleLabel}`,
            user.phone ? `📞 Phone: ${user.phone}` : null,
            `🕐 Joined: ${new Date().toLocaleString()}`,
        ].filter(Boolean).join('\n');
        await db_1.default.notification.createMany({
            data: admins.map(admin => ({
                userId: admin.id,
                type: 'NEW_USER',
                title: `🆕 New ${user.role === 'OPERATOR' ? 'Driver / Operator' : 'Passenger'} registered`,
                message: details,
                data: { userId: user.id, role: user.role, email: user.email, phone: user.phone },
            })),
        });
        const token = (0, auth_1.generateToken)({ id: user.id, role: user.role, username: user.username });
        return res.status(201).json({ user, token });
    }
    catch (error) {
        console.error('Signup error:', error);
        return res.status(500).json({ message: 'Server error during signup' });
    }
});
// ─── POST /api/auth/login ────────────────────────
exports.router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
    }
    try {
        // Support both email and username login
        const user = await db_1.default.user.findFirst({
            where: { OR: [{ email }, { username: email }] }
        });
        if (!user)
            return res.status(401).json({ message: 'Invalid credentials' });
        const valid = await bcryptjs_1.default.compare(password, user.password);
        if (!valid)
            return res.status(401).json({ message: 'Invalid credentials' });
        const { password: _, ...safeUser } = user;
        const token = (0, auth_1.generateToken)({ id: user.id, role: user.role, username: user.username });
        return res.json({ user: safeUser, token });
    }
    catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ message: 'Server error during login' });
    }
});
// ─── POST /api/auth/google ────────────────────────
exports.router.post('/google', async (req, res) => {
    const { email, displayName, googleId } = req.body;
    if (!email)
        return res.status(400).json({ message: 'Email required' });
    try {
        let user = await db_1.default.user.findFirst({ where: { email } });
        const isNewUser = !user;
        if (!user) {
            // Auto-create account
            const baseUsername = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
            let username = baseUsername;
            let count = 1;
            while (await db_1.default.user.findUnique({ where: { username } })) {
                username = `${baseUsername}${count++}`;
            }
            const randomPw = await bcryptjs_1.default.hash(Math.random().toString(36), 12);
            user = await db_1.default.user.create({
                data: { username, password: randomPw, displayName: displayName || email.split('@')[0], role: 'USER', email }
            });
            // Notify admins
            const admins = await db_1.default.user.findMany({ where: { role: 'ADMIN' } });
            await db_1.default.notification.createMany({
                data: admins.map(admin => ({
                    userId: admin.id,
                    type: 'NEW_USER',
                    title: '🆕 New user registered (Google)',
                    message: `👤 Name: ${user.displayName}\n📧 Email: ${user.email}\n🔑 Via: Google Sign-In`,
                    data: { userId: user.id, role: user.role },
                })),
            });
        }
        const { password: _, ...safeUser } = user;
        const token = (0, auth_1.generateToken)({ id: user.id, role: user.role, username: user.username });
        return res.json({ user: safeUser, token, isNew: isNewUser });
    }
    catch (error) {
        console.error('Google auth error:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});
// ─── POST /api/auth/reset-password ────────────────
exports.router.post('/reset-password', async (req, res) => {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) {
        return res.status(400).json({ message: 'Email and new password required' });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }
    try {
        const user = await db_1.default.user.findFirst({ where: { OR: [{ email }, { username: email }] } });
        if (!user)
            return res.status(404).json({ message: 'User not found' });
        const hashed = await bcryptjs_1.default.hash(newPassword, 12);
        await db_1.default.user.update({ where: { id: user.id }, data: { password: hashed } });
        return res.json({ message: 'Password reset successfully' });
    }
    catch (error) {
        return res.status(500).json({ message: 'Server error' });
    }
});
// ─── PUT /api/auth/profile ────────────────────────
exports.router.put('/profile', auth_1.authenticate, async (req, res) => {
    const { displayName, email, phone, bio, pushToken } = req.body;
    if (!displayName)
        return res.status(400).json({ message: 'Name required' });
    try {
        if (email) {
            const existing = await db_1.default.user.findFirst({ where: { email, NOT: { id: req.user.id } } });
            if (existing)
                return res.status(409).json({ message: 'Email already in use' });
        }
        const user = await db_1.default.user.update({
            where: { id: req.user.id },
            data: { displayName, email: email || null, phone: phone || null, bio: bio || null, pushToken: pushToken || null },
            select: { id: true, username: true, displayName: true, role: true, email: true, phone: true, bio: true, createdAt: true }
        });
        return res.json(user);
    }
    catch (error) {
        return res.status(500).json({ message: 'Server error' });
    }
});
// ─── GET /api/auth/me ────────────────────────────
exports.router.get('/me', auth_1.authenticate, async (req, res) => {
    try {
        const user = await db_1.default.user.findUnique({
            where: { id: req.user.id },
            select: { id: true, username: true, displayName: true, role: true, email: true, phone: true, bio: true, createdAt: true },
        });
        if (!user)
            return res.status(404).json({ message: 'User not found' });
        return res.json(user);
    }
    catch (error) {
        return res.status(500).json({ message: 'Server error' });
    }
});
// ─── PUT /api/auth/password ──────────────────────
exports.router.put('/password', auth_1.authenticate, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ message: 'New password must be at least 8 characters' });
    }
    try {
        const user = await db_1.default.user.findUnique({ where: { id: req.user.id } });
        if (!user)
            return res.status(404).json({ message: 'User not found' });
        const valid = await bcryptjs_1.default.compare(currentPassword, user.password);
        if (!valid)
            return res.status(401).json({ message: 'Current password is incorrect' });
        const hashed = await bcryptjs_1.default.hash(newPassword, 12);
        await db_1.default.user.update({ where: { id: user.id }, data: { password: hashed } });
        return res.json({ message: 'Password updated successfully' });
    }
    catch (error) {
        return res.status(500).json({ message: 'Server error' });
    }
});
// ─── DELETE /api/auth/account ────────────────────
exports.router.delete('/account', auth_1.authenticate, async (req, res) => {
    const { password } = req.body;
    if (!password)
        return res.status(400).json({ message: 'Password required' });
    try {
        const user = await db_1.default.user.findUnique({ where: { id: req.user.id } });
        if (!user)
            return res.status(404).json({ message: 'User not found' });
        const valid = await bcryptjs_1.default.compare(password, user.password);
        if (!valid)
            return res.status(401).json({ message: 'Incorrect password' });
        await db_1.default.notification.deleteMany({ where: { userId: req.user.id } });
        await db_1.default.reservation.deleteMany({ where: { userId: req.user.id } });
        await db_1.default.operatorRating.deleteMany({ where: { userId: req.user.id } });
        await db_1.default.user.delete({ where: { id: req.user.id } });
        return res.json({ message: 'Account deleted successfully' });
    }
    catch (error) {
        console.error('Delete account error:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});
// ─── POST /api/auth/update-role ────────────────────────
exports.router.post('/update-role', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader)
        return res.status(401).json({ message: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'secret');
        const { role } = req.body;
        if (!['USER', 'OPERATOR'].includes(role))
            return res.status(400).json({ message: 'Invalid role' });
        const user = await db_1.default.user.update({
            where: { id: decoded.id },
            data: { role },
        });
        const { password: _, ...safeUser } = user;
        return res.json({ user: safeUser });
    }
    catch (e) {
        return res.status(401).json({ message: 'Invalid token' });
    }
});
