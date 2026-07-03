import { Router, Request, Response } from 'express';
import prisma from '../db';
import { authenticate, requireOperator, AuthRequest } from '../middleware/auth';

export const router = Router();

function generateTrackingNumber(): string {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TN-${year}-${rand}`;
}

router.post('/', authenticate, requireOperator, async (req: AuthRequest, res: Response) => {
  const { senderName, senderPhone, receiverName, receiverPhone, description, fromCity, toCity, price, weight, notes, tripId } = req.body;
  if (!senderName || !senderPhone || !receiverName || !receiverPhone || !description || !fromCity || !toCity)
    return res.status(400).json({ message: 'Missing required fields' });
  try {
    let trackingNumber = generateTrackingNumber();
    while (await prisma.shipment.findUnique({ where: { trackingNumber } })) {
      trackingNumber = generateTrackingNumber();
    }
    const shipment = await prisma.shipment.create({
      data: {
        trackingNumber,
        operatorId: req.user!.id,
        tripId: tripId || null,
        senderName, senderPhone,
        receiverName, receiverPhone,
        description, fromCity, toCity,
        price: price ? parseFloat(price) : null,
        weight: weight ? parseFloat(weight) : null,
        notes: notes || null,
        status: 'RECEIVED',
      },
      include: { trip: { select: { id: true, fromCity: true, toCity: true, departureTime: true } } }
    });
    return res.status(201).json(shipment);
  } catch (e) { return res.status(500).json({ message: 'Server error' }); }
});

router.get('/track/:trackingNumber', async (req: Request, res: Response) => {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { trackingNumber: req.params.trackingNumber.toUpperCase() },
      include: { operator: { select: { displayName: true, username: true } } }
    });
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    return res.json(shipment);
  } catch (e) { return res.status(500).json({ message: 'Server error' }); }
});

router.get('/', authenticate, requireOperator, async (req: AuthRequest, res: Response) => {
  try {
    const shipments = await prisma.shipment.findMany({
      where: { operatorId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      include: {
        trip: { select: { id: true, fromCity: true, toCity: true, departureTime: true, type: true } }
      }
    });
    return res.json(shipments);
  } catch (e) { return res.status(500).json({ message: 'Server error' }); }
});

router.put('/:id/status', authenticate, requireOperator, async (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  const validStatuses = ['RECEIVED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
  if (!validStatuses.includes(status))
    return res.status(400).json({ message: 'Invalid status' });
  try {
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (shipment.operatorId !== req.user!.id)
      return res.status(403).json({ message: 'Forbidden' });
    const updated = await prisma.shipment.update({
      where: { id: req.params.id },
      data: { status }
    });
    return res.json(updated);
  } catch (e) { return res.status(500).json({ message: 'Server error' }); }
});

router.delete('/:id', authenticate, requireOperator, async (req: AuthRequest, res: Response) => {
  try {
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (shipment.operatorId !== req.user!.id)
      return res.status(403).json({ message: 'Forbidden' });
    await prisma.shipment.delete({ where: { id: req.params.id } });
    return res.json({ message: 'Deleted' });
  } catch (e) { return res.status(500).json({ message: 'Server error' }); }
});
