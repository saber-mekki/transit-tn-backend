import { Router, Response } from 'express';
import prisma from '../db';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';

export const router = Router();

router.use(authenticate);

// ─── GET /api/notifications ──────────────────────
// Admin gets all; users get their own
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const where = req.user!.role === 'ADMIN' ? {} : { userId: req.user!.id };
    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return res.json(notifications);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching notifications' });
  }
});

// ─── GET /api/notifications/unread-count ─────────
router.get('/unread-count', async (req: AuthRequest, res: Response) => {
  try {
    const where: any = { read: false };
    if (req.user!.role !== 'ADMIN') where.userId = req.user!.id;
    const count = await prisma.notification.count({ where });
    return res.json({ count });
  } catch (error) {
    return res.status(500).json({ message: 'Error counting notifications' });
  }
});

// ─── PUT /api/notifications/:id/read ────────────
router.put('/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const notif = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!notif) return res.status(404).json({ message: 'Notification not found' });
    if (notif.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const updated = await prisma.notification.update({
      where: { id: req.params.id },
      data: { read: true },
    });
    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ message: 'Error marking notification read' });
  }
});

// ─── PUT /api/notifications/read-all ────────────
router.put('/read-all', async (req: AuthRequest, res: Response) => {
  try {
    const where = req.user!.role === 'ADMIN' ? {} : { userId: req.user!.id };
    await prisma.notification.updateMany({ where, data: { read: true } });
    return res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    return res.status(500).json({ message: 'Error marking all read' });
  }
});

// ─── DELETE /api/notifications/:id ───────────────
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const notif = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!notif) return res.status(404).json({ message: 'Notification not found' });
    if (notif.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    await prisma.notification.delete({ where: { id: req.params.id } });
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ message: 'Error deleting notification' });
  }
});

// ─── POST /api/notifications ─────────────────────
// Admin creates a notification to send to a user
router.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  const { userId, type, title, message, data } = req.body;
  if (!userId || !title || !message) {
    return res.status(400).json({ message: 'userId, title and message are required' });
  }
  try {
    const notif = await prisma.notification.create({
      data: { userId, type: type || 'ADMIN_MESSAGE', title, message, data: data || {} },
    });
    return res.status(201).json(notif);
  } catch (error) {
    return res.status(500).json({ message: 'Error creating notification' });
  }
});
