import { Router, Response } from 'express';
import prisma from '../db';
import { authenticate, requireOperator, AuthRequest } from '../middleware/auth';

export const router = Router();

router.get('/', authenticate, requireOperator, async (req: AuthRequest, res: Response) => {
  try {
    const expenses = await prisma.expense.findMany({
      where: { operatorId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(expenses);
  } catch (e) { return res.status(500).json({ message: 'Server error' }); }
});

router.post('/', authenticate, requireOperator, async (req: AuthRequest, res: Response) => {
  const { label, amount, tripId, category } = req.body;
  if (!label || amount == null) return res.status(400).json({ message: 'Missing label or amount' });
  try {
    const expense = await prisma.expense.create({
      data: {
        operatorId: req.user!.id,
        label,
        category: category || 'OTHER',
        amount: parseFloat(amount),
        tripId: tripId || null,
      },
    });
    return res.status(201).json(expense);
  } catch (e) { return res.status(500).json({ message: 'Server error' }); }
});

router.delete('/:id', authenticate, requireOperator, async (req: AuthRequest, res: Response) => {
  try {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    if (expense.operatorId !== req.user!.id) return res.status(403).json({ message: 'Forbidden' });
    await prisma.expense.delete({ where: { id: req.params.id } });
    return res.json({ message: 'Deleted' });
  } catch (e) { return res.status(500).json({ message: 'Server error' }); }
});
