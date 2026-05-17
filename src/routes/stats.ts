import { Router, Request, Response } from 'express';
import prisma from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/auth';

export const router = Router();

router.get('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const [
      totalUsers, totalOperators, totalTrips,
      totalLouage, totalBus, totalTransporter,
      totalCompleted, totalActive, totalReservations,
      totalAccepted, totalRejected, totalPending,
      recentUsers, topOperators
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'USER' } }),
      prisma.user.count({ where: { role: 'OPERATOR' } }),
      prisma.trip.count(),
      prisma.trip.count({ where: { type: 'LOUAGE' } }),
      prisma.trip.count({ where: { type: 'BUS' } }),
      prisma.trip.count({ where: { type: 'TRANSPORTER' } }),
      prisma.trip.count({ where: { status: 'COMPLETED' } }),
      prisma.trip.count({ where: { status: 'ACTIVE' } }),
      prisma.reservation.count(),
      prisma.reservation.count({ where: { status: 'ACCEPTED' } }),
      prisma.reservation.count({ where: { status: 'REJECTED' } }),
      prisma.reservation.count({ where: { status: 'PENDING' } }),
      prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 5, select: { displayName: true, role: true, createdAt: true } }),
      prisma.user.findMany({
        where: { role: 'OPERATOR' },
        include: { operatorRatings: true, trips: { where: { status: 'COMPLETED' } } },
        take: 5
      })
    ]);

    const topRated = topOperators
      .map(op => ({
        name: op.displayName,
        avgRating: op.operatorRatings.length
          ? (op.operatorRatings.reduce((a, r) => a + r.score, 0) / op.operatorRatings.length).toFixed(1)
          : null,
        completedTrips: op.trips.length,
        totalRatings: op.operatorRatings.length
      }))
      .filter(op => op.avgRating)
      .sort((a, b) => parseFloat(b.avgRating!) - parseFloat(a.avgRating!))
      .slice(0, 3);

    return res.json({
      users: { total: totalUsers, operators: totalOperators },
      trips: { total: totalTrips, louage: totalLouage, bus: totalBus, transporter: totalTransporter, completed: totalCompleted, active: totalActive },
      reservations: { total: totalReservations, accepted: totalAccepted, rejected: totalRejected, pending: totalPending },
      recentUsers,
      topRated,
    });
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
});
