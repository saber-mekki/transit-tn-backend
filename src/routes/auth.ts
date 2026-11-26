import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
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
      select: { id: true, username: true, displayName: true, role: true, email: true, phone: true, bio: true, createdAt: true, plan: true, planExpiresAt: true },
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
// Body: { idToken, role?, requireRole? }
//   role = "USER" | "OPERATOR": used only when creating a new account (existing roles never change)
//   requireRole = true (login screen): if no account exists and no role was sent, nothing is
//     created and { needsRole: true } is returned so the app can ask Utilisateur / Opérateur first.
//   Neither sent (older app versions): new accounts are created as USER.
// Accepted audiences: every OAuth client the apps may obtain an ID token for.
// Native google-signin and the web flow both issue tokens whose `aud` is the WEB client ID.
const GOOGLE_CLIENT_IDS = Array.from(new Set([
  process.env.GOOGLE_WEB_CLIENT_ID,
  process.env.GOOGLE_ANDROID_CLIENT_ID,
  process.env.GOOGLE_IOS_CLIENT_ID,
  ...(process.env.GOOGLE_CLIENT_IDS || '').split(','),
  // Fallback: current web client, so existing deployments keep working without new env vars
  '124636272128-eg5v01of98ev5mfb85p8evikqoermofl.apps.googleusercontent.com',
].map(s => (s || '').trim()).filter(Boolean)));

const googleClient = new OAuth2Client();

async function verifyGoogleIdToken(idToken: string) {
  const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_IDS });
  const p = ticket.getPayload();
  if (!p || !p.sub || !p.email || !p.email_verified) return null;
  return { googleId: p.sub, email: p.email.toLowerCase(), displayName: p.name };
}

router.post('/google', async (req: Request, res: Response) => {
  const { idToken } = req.body;
  if (!idToken || typeof idToken !== 'string') return res.status(400).json({ message: 'idToken required' });
  const roleProvided = typeof req.body.role === 'string' && req.body.role !== '';
  const requireRole = req.body.requireRole === true;
  const requestedRole = roleProvided ? req.body.role.toUpperCase() : 'USER';
  if (!['USER', 'OPERATOR'].includes(requestedRole)) {
    return res.status(400).json({ message: 'Role must be USER or OPERATOR' });
  }

  let google: Awaited<ReturnType<typeof verifyGoogleIdToken>>;
  try {
    google = await verifyGoogleIdToken(idToken);
  } catch (e) {
    console.warn('Google token rejected:', (e as Error).message);
    return res.status(401).json({ message: 'Invalid Google token' });
  }
  if (!google) return res.status(401).json({ message: 'Invalid Google token' });

  try {
    const { googleId, email, displayName } = google;

    let user = await prisma.user.findUnique({ where: { googleId } })
      ?? await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    const isNewUser = !user;

    if (!user && requireRole && !roleProvided) {
      // First Google sign-in from the login screen: let the user choose their role before creating anything
      return res.json({ needsRole: true, email, displayName: displayName || email.split('@')[0] });
    }

    if (user) {
      // Existing account (email/password or Google): link it; never change its role here
      if (!user.googleId) {
        user = await prisma.user.update({ where: { id: user.id }, data: { googleId } });
      }
    } else {
      const baseUsername = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
      let username = baseUsername;
      let count = 1;
      while (await prisma.user.findUnique({ where: { username } })) {
        username = `${baseUsername}${count++}`;
      }
      // Unusable random password: the account signs in with Google (or via reset-password)
      const randomPw = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
      user = await prisma.user.create({
        data: {
          username, password: randomPw, email, googleId,
          displayName: displayName || email.split('@')[0],
          role: requestedRole as UserRole,
        },
      });

      const created = user;
      const roleLabel = created.role === 'OPERATOR' ? '🚗 Driver / Operator' : '👤 Passenger';
      const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
      await prisma.notification.createMany({
        data: admins.map(admin => ({
          userId: admin.id,
          type: 'NEW_USER',
          title: `🆕 New ${created.role === 'OPERATOR' ? 'Driver / Operator' : 'Passenger'} registered (Google)`,
          message: [
            `👤 Name: ${created.displayName}`,
            `🔑 Username: @${created.username}`,
            `🎭 Role: ${roleLabel}`,
            `📧 Email: ${created.email}`,
            `🔐 Via: Google Sign-In`,
            `🕐 Joined: ${new Date().toLocaleString()}`,
          ].join('\n'),
          data: { userId: created.id, role: created.role, email: created.email },
        })),
      });
    }

    const { password: _, ...safeUser } = user;
    const token = generateToken({ id: user.id, role: user.role, username: user.username });
    return res.json({ user: safeUser, token, isNew: isNewUser });
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
  const { displayName, email, phone, bio, pushToken } = req.body;
  if (!displayName) return res.status(400).json({ message: 'Name required' });
  try {
    if (email) {
      const existing = await prisma.user.findFirst({ where: { email, NOT: { id: req.user!.id } } });
      if (existing) return res.status(409).json({ message: 'Email already in use' });
    }
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { displayName, email: email || null, phone: phone || null, bio: bio || null, pushToken: pushToken === undefined ? undefined : pushToken || null },
      select: { id: true, username: true, displayName: true, role: true, email: true, phone: true, bio: true, createdAt: true }
    });
    return res.json(user);
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// ─── PUT /api/auth/push-token ────────────────────
router.put('/push-token', authenticate, async (req: AuthRequest, res: Response) => {
  const { pushToken } = req.body;
  if (pushToken !== null && typeof pushToken !== 'string') return res.status(400).json({ message: 'pushToken must be a string or null' });
  try {
    await prisma.user.update({ where: { id: req.user!.id }, data: { pushToken } });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/auth/me ────────────────────────────
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, username: true, displayName: true, role: true, email: true, phone: true, bio: true, createdAt: true, plan: true, planExpiresAt: true },
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

// ─── DELETE /api/auth/account ────────────────────
router.delete('/account', authenticate, async (req: AuthRequest, res: Response) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ message: 'Password required' });
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ message: 'User not found' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: 'Incorrect password' });
    await prisma.notification.deleteMany({ where: { userId: req.user!.id } });
    await prisma.reservation.deleteMany({ where: { userId: req.user!.id } });
    await prisma.operatorRating.deleteMany({ where: { userId: req.user!.id } });
    await prisma.user.delete({ where: { id: req.user!.id } });
    return res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// ─── POST /api/auth/update-role ────────────────────────
router.post('/update-role', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded: any = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'secret');
    const { role } = req.body;
    if (!['USER', 'OPERATOR'].includes(role)) return res.status(400).json({ message: 'Invalid role' });
    const user = await prisma.user.update({
      where: { id: decoded.id },
      data: { role },
    });
    const { password: _, ...safeUser } = user;
    return res.json({ user: safeUser });
  } catch (e) {
    return res.status(401).json({ message: 'Invalid token' });
  }
});
