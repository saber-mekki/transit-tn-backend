import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';
import prisma from '../db';
import { authenticate, generateToken, AuthRequest } from '../middleware/auth';

export const router = Router();

// ─── POST /api/auth/signup ───────────────────────
router.post('/signup', async (req: Request, res: Response) => {
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
    const emailTaken = await prisma.user.findUnique({ where: { email } });
    if (emailTaken) return res.status(409).json({ message: 'Email already in use' });

    // Auto-generate username from email
    const baseUsername = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    let username = baseUsername;
    let count = 1;
    while (await prisma.user.findUnique({ where: { username } })) {
      username = `${baseUsername}${count++}`;
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { username, password: hashed, displayName, role: role.toUpperCase() as UserRole, email, phone: phone || null },
      select: { id: true, username: true, displayName: true, role: true, email: true, phone: true, bio: true, createdAt: true },
    });

    // Notify all admins
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    const roleLabel = user.role === 'OPERATOR' ? '🚗 Driver / Operator' : '👤 Passenger';
    const details = [
      `👤 Name: ${user.displayName}`,
      `📧 Email: ${user.email}`,
      `🎭 Role: ${roleLabel}`,
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
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    // Support both email and username login
    const user = await prisma.user.findFirst({
      where: { OR: [{ email }, { username: email }] }
    });
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


// ─── POST /api/auth/google ────────────────────────
router.post('/google', async (req: Request, res: Response) => {
  const { email, displayName, googleId } = req.body;
  if (!email) return res.status(400).json({ message: 'Email required' });

  try {
    let user = await prisma.user.findFirst({ where: { email } });
    
    if (!user) {
      // Auto-create account
      const baseUsername = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
      let username = baseUsername;
      let count = 1;
      while (await prisma.user.findUnique({ where: { username } })) {
        username = `${baseUsername}${count++}`;
      }
      const randomPw = await bcrypt.hash(Math.random().toString(36), 12);
      user = await prisma.user.create({
        data: { username, password: randomPw, displayName: displayName || email.split('@')[0], role: 'USER', email }
      });

      // Notify admins
      const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
      await prisma.notification.createMany({
        data: admins.map(admin => ({
          userId: admin.id,
          type: 'NEW_USER',
          title: '🆕 New user registered (Google)',
          message: `👤 Name: ${user!.displayName}\n📧 Email: ${user!.email}\n🔑 Via: Google Sign-In`,
          data: { userId: user!.id, role: user!.role },
        })),
      });
    }

    const { password: _, ...safeUser } = user;
    const token = generateToken({ id: user.id, role: user.role, username: user.username });
    return res.json({ user: safeUser, token });
  } catch (error) {
    console.error('Google auth error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});


// ─── POST /api/auth/reset-password ────────────────
router.post('/reset-password', async (req: Request, res: Response) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) {
    return res.status(400).json({ message: 'Email and new password required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' });
  }
  try {
    const user = await prisma.user.findFirst({ where: { OR: [{ email }, { username: email }] } });
    if (!user) return res.status(404).json({ message: 'User not found' });
    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
    return res.json({ message: 'Password reset successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});


// ─── PUT /api/auth/profile ────────────────────────
router.put('/profile', authenticate, async (req: AuthRequest, res: Response) => {
  const { displayName, email, phone, bio } = req.body;
  if (!displayName) return res.status(400).json({ message: 'Name required' });
  try {
    if (email) {
      const existing = await prisma.user.findFirst({ where: { email, NOT: { id: req.user!.id } } });
      if (existing) return res.status(409).json({ message: 'Email already in use' });
    }
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { displayName, email: email || null, phone: phone || null, bio: bio || null },
      select: { id: true, username: true, displayName: true, role: true, email: true, phone: true, bio: true, createdAt: true }
    });
    return res.json(user);
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/auth/me ────────────────────────────
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, username: true, displayName: true, role: true, email: true, phone: true, bio: true, createdAt: true },
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
