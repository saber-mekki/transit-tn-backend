import { Router, Request, Response } from 'express';
import prisma from '../db';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';

export const router = Router();

// ─── GET /api/stations ───────────────────────────
// Public
router.get('/', async (_req: Request, res: Response) => {
  try {
    const stations = await prisma.station.findMany({ orderBy: { city: 'asc' } });
    return res.json(stations);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching stations' });
  }
});

// ─── GET /api/stations/:id ───────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const station = await prisma.station.findUnique({ where: { id: req.params.id } });
    if (!station) return res.status(404).json({ message: 'Station not found' });
    return res.json(station);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching station' });
  }
});

// ─── POST /api/stations ──────────────────────────
// Admin only
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { name, city, lat, lng } = req.body;
  if (!name || !city) {
    return res.status(400).json({ message: 'name and city are required' });
  }
  try {
    const station = await prisma.station.create({
      data: { name, city, lat: parseFloat(lat) || 0, lng: parseFloat(lng) || 0 },
    });
    return res.status(201).json(station);
  } catch (error) {
    return res.status(500).json({ message: 'Error creating station' });
  }
});

// ─── PUT /api/stations/:id ───────────────────────
router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { name, city, lat, lng } = req.body;
  try {
    const updated = await prisma.station.update({
      where: { id },
      data: { ...(name && { name }), ...(city && { city }), ...(lat !== undefined && { lat: parseFloat(lat) }), ...(lng !== undefined && { lng: parseFloat(lng) }) },
    });
    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ message: 'Error updating station' });
  }
});

// ─── DELETE /api/stations/:id ────────────────────
router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.station.delete({ where: { id: req.params.id } });
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ message: 'Error deleting station' });
  }
});
