import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';
import prisma from '../db';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';

export const router = Router();

// Admin: set user plan
router.put('/set-plan', authenticate, requireAdmin, async (req: any, res: any) => {
  const { userId, plan, months } = req.body;
  if (!userId || !plan) return res.status(400).json({ message: 'userId and plan required' });
  const validPlans = ['FREE', 'PRO', 'BUSINESS'];
  if (!validPlans.includes(plan)) return res.status(400).json({ message: 'Invalid plan' });
  try {
    const planExpiresAt = plan === 'FREE' ? null : new Date(Date.now() + (months || 1) * 30 * 24 * 3600 * 1000);
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { plan, planExpiresAt },
    });
    return res.json({ id: updated.id, plan: updated.plan, planExpiresAt: updated.planExpiresAt });
  } catch (e) { return res.status(500).json({ message: 'Server error' }); }
});

// All user routes require auth
router.use(authenticate);

// ─── GET /api/users ──────────────────────────────
// Admin only: list all users
router.get('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.query;
    const where: any = {};
    if (role) where.role = String(role).toUpperCase();
    const users = await prisma.user.findMany({
      where,
      select: { id: true, username: true, displayName: true, role: true, email: true, phone: true, createdAt: true, plan: true, planExpiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(users);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching users' });
  }
});

// ─── GET /api/users/:id ──────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, displayName: true, role: true, phone: true, bio: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ message: 'User not found' });
    // Only return public info for operators, full info for own profile/admin
    if (req.user?.role === 'ADMIN' || req.user?.id === id) {
      const full = await prisma.user.findUnique({
        where: { id },
        select: { id: true, username: true, displayName: true, role: true, email: true, phone: true, bio: true, createdAt: true },
      });
      return res.json(full);
    }
    return res.json(user);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching user' });
  }
});

// ─── PUT /api/users/:id ──────────────────────────
// Admin: change role. User: update own profile
router.put('/:id', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const isAdmin = req.user!.role === 'ADMIN';
  const isSelf = req.user!.id === id;

  if (!isAdmin && !isSelf) return res.status(403).json({ message: 'Forbidden' });

  const { role, displayName, email, phone } = req.body;

  try {
    const updateData: Record<string, unknown> = {};

    // Only admin can change roles
    if (role && isAdmin) {
      if (!Object.values(UserRole).includes(role.toUpperCase() as UserRole)) {
        return res.status(400).json({ message: 'Invalid role' });
      }
      updateData.role = role.toUpperCase() as UserRole;
    }
    if (displayName) updateData.displayName = displayName;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: { id: true, username: true, displayName: true, role: true, email: true, phone: true },
    });
    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ message: 'Error updating user' });
  }
});

// ─── DELETE /api/users/:id ───────────────────────
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.username === 'admin') {
      return res.status(403).json({ message: 'Cannot delete the primary admin account' });
    }
    if (req.user!.id === id) {
      return res.status(403).json({ message: 'Cannot delete your own account' });
    }
    await prisma.user.delete({ where: { id } });
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ message: 'Error deleting user' });
  }
});

// ─── POST /api/users ─────────────────────────────
// Admin creates a user directly
router.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  const { username, password, displayName, role, email, phone } = req.body;
  if (!username || !password || !displayName || !role) {
    return res.status(400).json({ message: 'username, password, displayName and role are required' });
  }
  try {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return res.status(409).json({ message: 'Username already taken' });
    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { username, password: hashed, displayName, role: role.toUpperCase() as UserRole, email: email || null, phone: phone || null },
      select: { id: true, username: true, displayName: true, role: true, email: true, phone: true, createdAt: true },
    });
    return res.status(201).json(user);
  } catch (error) {
    return res.status(500).json({ message: 'Error creating user' });
  }
});
