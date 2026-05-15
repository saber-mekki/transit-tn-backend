import { Router, Request, Response } from 'express';
import prisma from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

export const router = Router();

// GET /api/operators/leaderboard - MUST be before /:id routes
router.get('/leaderboard', async (req: Request, res: Response) => {
  try {
    const operators = await prisma.user.findMany({
      where: { role: 'OPERATOR' },
      include: { operatorRatings: true }
    });
    const ranked = operators
      .map(op => ({
        id: op.id,
        displayName: op.displayName,
        ratingCount: op.operatorRatings.length,
        avgRating: op.operatorRatings.length
          ? (op.operatorRatings.reduce((a, r) => a + r.score, 0) / op.operatorRatings.length).toFixed(1)
          : null
      }))
      .filter(op => op.ratingCount > 0)
      .sort((a, b) => parseFloat(b.avgRating || '0') - parseFloat(a.avgRating || '0'));
    return res.json(ranked);
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/operators/:id/ratings
router.get('/:id/ratings', async (req: Request, res: Response) => {
  try {
    const ratings = await prisma.operatorRating.findMany({
      where: { operatorId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    const avg = ratings.length
      ? (ratings.reduce((a, r) => a + r.score, 0) / ratings.length).toFixed(1)
      : null;
    return res.json({ ratings, avg, count: ratings.length });
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/operators/:id/rate
router.post('/:id/rate', authenticate, async (req: AuthRequest, res: Response) => {
  const { score, comment } = req.body;
  if (!score || score < 1 || score > 5)
    return res.status(400).json({ message: 'Score must be 1-5' });
  try {
    const operator = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!operator) return res.status(404).json({ message: 'Operator not found' });
    if (operator.role !== 'OPERATOR')
      return res.status(400).json({ message: 'Can only rate operators' });
    if (operator.id === req.user!.id)
      return res.status(400).json({ message: 'Cannot rate yourself' });

    const existing = await prisma.operatorRating.findFirst({
      where: { operatorId: req.params.id, userId: req.user!.id }
    });
    if (existing) {
      const updated = await prisma.operatorRating.update({
        where: { id: existing.id },
        data: { score, comment: comment || null }
      });
      return res.json(updated);
    }

    const rating = await prisma.operatorRating.create({
      data: { operatorId: req.params.id, userId: req.user!.id, score, comment: comment || null }
    });
    return res.status(201).json(rating);
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
});

