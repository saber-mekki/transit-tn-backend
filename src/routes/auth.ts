import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';
import prisma from '../db';
import { authenticate, generateToken, AuthRequest } from '../middleware/auth';

export const router = Router();

// ─── POST /api/auth/signup ───────────────────────
router.post('/signup', async (req: Request, res: Response) => {
  const { username, password, displayName, role, email, phone } = req.body;

  if (!username || !password || !displayName || !role) {
    return res.status(400).json({ message: 'username, password, displayName and role are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' });
  }
  const validRoles = ['USER', 'OPERATOR'];
  if (!validRoles.includes(role.toUpperCase())) {
    return res.status(400).json({ message: 'Role must be USER or OPERATOR' });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return res.status(409).json({ message: 'Username already taken' });
    }
    if (email) {
      const emailTaken = await prisma.user.findUnique({ where: { email } });
      if (emailTaken) return res.status(409).json({ message: 'Email already in use' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { username, password: hashed, displayName, role: role.toUpperCase() as UserRole, email: email || null, phone: phone || null },
      select: { id: true, username: true, displayName: true, role: true, email: true, phone: true, createdAt: true },
    });

    // Notify all admins with full user info
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    const roleLabel = user.role === 'OPERATOR' ? '🚗 Driver / Operator' : '👤 Passenger';
    const details = [
      `👤 Name: ${user.displayName}`,
      `🔑 Username: @${user.username}`,
      `🎭 Role: ${roleLabel}`,
      user.email ? `📧 Email: ${user.email}` : null,
      user.phone ? `📞 Phone: ${user.phone}` : null,
      `🕐 Joined: ${new Date().toLocaleString()}`,
    ].filter(Boolean).join('\n');

    await prisma.notification.createMany({
      data: admins.map(admin => ({
        userId: admin.id,
        type: 'NEW_USER',
        title: `🆕 New ${user.role === 'OPERATOR' ? 'Driver / Operator' : 'Passenger'} registered`,
        message: details,
        data: { userId: user.id, role: user.role, email: user.email, phone: user.phone },
      })),
    });

    const token = generateToken({ id: user.id, role: user.role, username: user.username });
    return res.status(201).json({ user, token });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ message: 'Server error during signup' });
  }
});

// ─── POST /api/auth/login ────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

    const { password: _, ...safeUser } = user;
    const token = generateToken({ id: user.id, role: user.role, username: user.username });
    return res.json({ user: safeUser, token });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Server error during login' });
  }
});

// ─── GET /api/auth/me ────────────────────────────
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, username: true, displayName: true, role: true, email: true, phone: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json(user);
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// ─── PUT /api/auth/password ──────────────────────
router.put('/password', authenticate, async (req: AuthRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ message: 'New password must be at least 8 characters' });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ message: 'User not found' });
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ message: 'Current password is incorrect' });
    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
    return res.json({ message: 'Password updated successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});
