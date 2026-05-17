import { Router, Request, Response } from 'express';
import prisma from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

export const router = Router();

// POST /api/reservations — user creates reservation
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  const { tripId, userPhone, note } = req.body;
  if (!tripId || !userPhone) return res.status(400).json({ message: 'tripId and userPhone required' });
  try {
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) return res.status(404).json({ message: 'Trip not found' });
    if (trip.status === 'COMPLETED') return res.status(400).json({ message: 'Trip is completed' });

    // Check if already reserved
    const existing = await prisma.reservation.findFirst({
      where: { tripId, userId: req.user!.id, status: { not: 'REJECTED' } }
    });
    if (existing) return res.status(409).json({ message: 'Already reserved' });

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    const reservation = await prisma.reservation.create({
      data: {
        tripId,
        userId: req.user!.id,
        userName: user?.displayName || 'Unknown',
        userPhone,
        note: note || null,
        status: 'PENDING'
      }
    });

    // Notify operator
    await prisma.notification.create({
      data: {
        userId: trip.operatorId,
        type: 'RESERVATION',
        title: '🔔 Nouvelle réservation',
        message: `👤 ${user?.displayName}\n📞 ${userPhone}${note ? '\n📝 ' + note : ''}\n🚗 ${trip.fromCity} → ${trip.toCity}`,
        data: { reservationId: reservation.id, tripId }
      }
    });

    return res.status(201).json(reservation);
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/reservations/trip/:tripId — operator sees reservations for a trip
router.get('/trip/:tripId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const trip = await prisma.trip.findUnique({ where: { id: req.params.tripId } });
    if (!trip) return res.status(404).json({ message: 'Trip not found' });
    if (req.user?.role !== 'ADMIN' && trip.operatorId !== req.user?.id)
      return res.status(403).json({ message: 'Forbidden' });

    const reservations = await prisma.reservation.findMany({
      where: { tripId: req.params.tripId },
      orderBy: { createdAt: 'desc' }
    });
    return res.json(reservations);
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/reservations/my — user sees their reservations
router.get('/my', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const reservations = await prisma.reservation.findMany({
      where: { userId: req.user!.id },
      include: { trip: { select: { fromCity: true, toCity: true, departureTime: true, type: true, operatorName: true } } },
      orderBy: { createdAt: 'desc' }
    });
    return res.json(reservations);
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/reservations/:id — operator accepts/rejects
router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  if (!['ACCEPTED', 'REJECTED'].includes(status))
    return res.status(400).json({ message: 'Status must be ACCEPTED or REJECTED' });
  try {
    const reservation = await prisma.reservation.findUnique({
      where: { id: req.params.id },
      include: { trip: true }
    });
    if (!reservation) return res.status(404).json({ message: 'Not found' });
    if (req.user?.role !== 'ADMIN' && reservation.trip.operatorId !== req.user?.id)
      return res.status(403).json({ message: 'Forbidden' });

    await prisma.reservation.update({ where: { id: req.params.id }, data: { status } });

    // Decrease seats if ACCEPTED and LOUAGE
    if (status === 'ACCEPTED' && reservation.trip.type === 'LOUAGE') {
      await prisma.louageTrip.updateMany({
        where: { tripId: reservation.tripId },
        data: { availableSeats: { decrement: 1 } }
      });
    }

    // Notify user
    await prisma.notification.create({
      data: {
        userId: reservation.userId,
        type: 'RESERVATION_UPDATE',
        title: status === 'ACCEPTED' ? '✅ Réservation acceptée!' : '❌ Réservation refusée',
        message: `${reservation.trip.fromCity} → ${reservation.trip.toCity}\n${status === 'ACCEPTED' ? 'Le conducteur a accepté votre réservation. Il vous contactera.' : 'Le conducteur a refusé votre réservation.'}`,
        data: { reservationId: reservation.id }
      }
    });

    return res.json({ message: 'Updated' });
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/reservations/:id — user cancels pending reservation
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const reservation = await prisma.reservation.findUnique({ where: { id: req.params.id } });
    if (!reservation) return res.status(404).json({ message: 'Not found' });
    if (reservation.userId !== req.user!.id && req.user?.role !== 'ADMIN')
      return res.status(403).json({ message: 'Forbidden' });
    if (reservation.status !== 'PENDING')
      return res.status(400).json({ message: 'Can only cancel pending reservations' });
    await prisma.reservation.delete({ where: { id: req.params.id } });
    return res.json({ message: 'Cancelled' });
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
});
