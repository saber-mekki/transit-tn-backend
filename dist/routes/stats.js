"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const auth_2 = require("../middleware/auth");
exports.router = (0, express_1.Router)();
exports.router.get('/', auth_1.authenticate, auth_2.requireAdmin, async (req, res) => {
    try {
        const [totalUsers, totalOperators, totalTrips, totalLouage, totalBus, totalTransporter, totalCompleted, totalActive, totalReservations, totalAccepted, totalRejected, totalPending, recentUsers, topOperators] = await Promise.all([
            db_1.default.user.count({ where: { role: 'USER' } }),
            db_1.default.user.count({ where: { role: 'OPERATOR' } }),
            db_1.default.trip.count(),
            db_1.default.trip.count({ where: { type: 'LOUAGE' } }),
            db_1.default.trip.count({ where: { type: 'BUS' } }),
            db_1.default.trip.count({ where: { type: 'TRANSPORTER' } }),
            db_1.default.trip.count({ where: { status: 'COMPLETED' } }),
            db_1.default.trip.count({ where: { status: 'ACTIVE' } }),
            db_1.default.reservation.count(),
            db_1.default.reservation.count({ where: { status: 'ACCEPTED' } }),
            db_1.default.reservation.count({ where: { status: 'REJECTED' } }),
            db_1.default.reservation.count({ where: { status: 'PENDING' } }),
            db_1.default.user.findMany({ orderBy: { createdAt: 'desc' }, take: 5, select: { displayName: true, role: true, createdAt: true } }),
            db_1.default.user.findMany({
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
            .sort((a, b) => parseFloat(b.avgRating) - parseFloat(a.avgRating))
            .slice(0, 3);
        return res.json({
            users: { total: totalUsers, operators: totalOperators },
            trips: { total: totalTrips, louage: totalLouage, bus: totalBus, transporter: totalTransporter, completed: totalCompleted, active: totalActive },
            reservations: { total: totalReservations, accepted: totalAccepted, rejected: totalRejected, pending: totalPending },
            recentUsers,
            topRated,
        });
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
