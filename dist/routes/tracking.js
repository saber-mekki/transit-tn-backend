"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackingLimiter = exports.router = void 0;
exports.canView = canView;
// ─── LIVE TRANSPORTER TRACKING ───────────────────────────────────────
// Mounted on /api/trips (before the main trips router) so it serves:
//   GET  /api/trips/tracking/mine              → driver's trip currently en_cours (any type)
//   GET  /api/trips/:tripId/tracking           → status (+ last position if allowed)
//   POST /api/trips/:tripId/tracking/start     → driver: "Démarrer le trajet"
//   POST /api/trips/:tripId/tracking/stop      → driver: end live tracking { status?: livre|annule }
//   GET  /api/trips/:tripId/route              → traveled path [[lat,lng],…] (public while en_cours)
//   POST /api/trips/:tripId/location           → transporter pushes { lat, lng, speed?, heading? }
//   GET  /api/trips/:tripId/location/stream    → SSE live updates (one trip, linked users)
//   GET  /api/trips/live-map/stream            → SSE all en_cours trips (public live map)
const express_1 = __importStar(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const liveTracking_1 = require("../utils/liveTracking");
exports.router = (0, express_1.Router)();
// Own limiter: these routes are registered before the global 100/15min limiter,
// because a transporter alone sends ~30 positions per 15 min.
// Applied per route (not router.use) so other /api/trips requests are untouched.
exports.trackingLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    // Override locally to run scripts/simulate-live-trips.sh at a fast pace.
    max: Number(process.env.TRACKING_RATE_LIMIT) || 400,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests, please try again later.' },
});
const smallJson = express_1.default.json({ limit: '10kb' });
/** Is this (possibly anonymous) user allowed to watch the trip's position? */
async function canView(user, trip, trackingNumber) {
    if (!user)
        return false;
    if (user.role === 'ADMIN' || trip.operatorId === user.id)
        return true;
    const reservation = await db_1.default.reservation.findFirst({
        where: { tripId: trip.id, userId: user.id, status: { not: 'REJECTED' } },
        select: { id: true },
    });
    if (reservation)
        return true;
    // A client who knows the tracking number of a parcel on this trip is linked to it.
    if (trackingNumber) {
        const shipment = await db_1.default.shipment.findFirst({
            where: { trackingNumber: trackingNumber.toUpperCase(), tripId: trip.id },
            select: { id: true },
        });
        if (shipment)
            return true;
    }
    return false;
}
// ─── GET /api/trips/live-map/stream (SSE, public) ─
// Feeds the public live map page: every trip currently en_cours.
// Events: snapshot [all], location {tripId,...}, remove {tripId,status}.
exports.router.get('/live-map/stream', exports.trackingLimiter, (req, res) => {
    if ((0, liveTracking_1.mapStreamCount)() >= liveTracking_1.MAX_MAP_STREAMS) {
        return res.status(503).json({ message: 'Too many viewers, retry later' });
    }
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    const snapshot = (0, liveTracking_1.liveSnapshot)();
    (0, liveTracking_1.sendEvent)(res, 'snapshot', snapshot);
    // Same data as individual "location" events, for clients that only listen to those.
    snapshot.forEach(loc => (0, liveTracking_1.sendEvent)(res, 'location', loc));
    (0, liveTracking_1.addMapStream)(res);
    const ping = setInterval(() => { try {
        res.write(': ping\n\n');
    }
    catch { /* ignore */ } }, 20000);
    req.on('close', () => {
        clearInterval(ping);
        (0, liveTracking_1.removeMapStream)(res);
    });
});
// ─── GET /api/trips/tracking/mine ────────────────
// The driver's trip that should be sharing its position right now:
// a transporter trip with parcels in transit, a trip started with
// "Démarrer le trajet", or a louage/bus trip inside its departure window.
const tripSelect = { id: true, fromCity: true, toCity: true, type: true, departureTime: true };
const lower = (t) => (t ? { ...t, type: String(t.type).toLowerCase() } : null);
exports.router.get('/tracking/mine', exports.trackingLimiter, auth_1.authenticate, async (req, res) => {
    const me = req.user.id;
    try {
        const shipment = await db_1.default.shipment.findFirst({
            where: { status: 'IN_TRANSIT', trip: { operatorId: me } },
            orderBy: { updatedAt: 'desc' },
            select: { trip: { select: tripSelect } },
        });
        if (shipment?.trip)
            return res.json({ trip: lower(shipment.trip) });
        const now = Date.now();
        const candidates = await db_1.default.trip.findMany({
            where: {
                operatorId: me,
                status: { not: 'COMPLETED' },
                OR: [
                    // inside (or just before) the departure window
                    { type: { in: ['LOUAGE', 'BUS'] }, departureTime: { lte: new Date(now + 15 * 60000), gte: new Date(now - 48 * 3600000) } },
                    // started by hand, whatever the date
                    { liveTracking: { is: { startedAt: { not: null }, endedAt: null } } },
                ],
            },
            orderBy: { departureTime: 'desc' },
            take: 10,
            select: tripSelect,
        }).catch(async () => 
        // TripTracking table not created yet: window only.
        db_1.default.trip.findMany({
            where: {
                operatorId: me, status: { not: 'COMPLETED' }, type: { in: ['LOUAGE', 'BUS'] },
                departureTime: { lte: new Date(now + 15 * 60000), gte: new Date(now - 48 * 3600000) },
            },
            orderBy: { departureTime: 'desc' }, take: 10, select: tripSelect,
        }));
        for (const trip of candidates) {
            if ((await (0, liveTracking_1.getTrackingStatus)(trip.id)) === 'en_cours')
                return res.json({ trip: lower(trip) });
        }
        return res.json({ trip: null });
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
// ─── POST /api/trips/:tripId/tracking/start|stop ─
async function ownTrip(req, res) {
    const trip = await db_1.default.trip.findUnique({ where: { id: req.params.tripId }, select: { id: true, operatorId: true } });
    if (!trip) {
        res.status(404).json({ message: 'Trip not found' });
        return null;
    }
    if (req.user.role !== 'ADMIN' && trip.operatorId !== req.user.id) {
        res.status(403).json({ message: 'Only the trip driver can do this' });
        return null;
    }
    return trip;
}
exports.router.post('/:tripId/tracking/start', exports.trackingLimiter, auth_1.authenticate, async (req, res) => {
    try {
        if (!(await ownTrip(req, res)))
            return;
        await (0, liveTracking_1.startTripManually)(req.params.tripId);
        await (0, liveTracking_1.refreshTracking)(req.params.tripId);
        return res.json({ status: await (0, liveTracking_1.getTrackingStatus)(req.params.tripId, true) });
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
exports.router.post('/:tripId/tracking/stop', exports.trackingLimiter, smallJson, auth_1.authenticate, async (req, res) => {
    try {
        if (!(await ownTrip(req, res)))
            return;
        const status = req.body?.status === 'annule' ? 'annule' : 'livre';
        await (0, liveTracking_1.endTripManually)(req.params.tripId, status);
        await (0, liveTracking_1.refreshTracking)(req.params.tripId);
        return res.json({ status: await (0, liveTracking_1.getTrackingStatus)(req.params.tripId, true) });
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
// ─── GET /api/trips/:tripId/route ────────────────
// Traveled path. Public while the trip is en_cours (the live map already shows
// the vehicle to everyone); afterwards only for users linked to the trip.
exports.router.get('/:tripId/route', exports.trackingLimiter, auth_1.optionalAuth, async (req, res) => {
    const { tripId } = req.params;
    try {
        const trip = await db_1.default.trip.findUnique({ where: { id: tripId }, select: { id: true, operatorId: true } });
        if (!trip)
            return res.status(404).json({ message: 'Trip not found' });
        const status = await (0, liveTracking_1.getTrackingStatus)(tripId);
        if (status !== 'en_cours' && !(await canView(req.user, trip, req.query.tracking))) {
            return res.status(403).json({ message: 'Not linked to this trip' });
        }
        const points = await (0, liveTracking_1.getRoute)(tripId);
        return res.json({
            tripId,
            status,
            points: (0, liveTracking_1.simplifyRoute)(points),
            location: status === 'en_cours' ? (0, liveTracking_1.getLocation)(tripId) : null,
        });
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
// ─── GET /api/trips/:tripId/tracking ─────────────
exports.router.get('/:tripId/tracking', exports.trackingLimiter, auth_1.optionalAuth, async (req, res) => {
    const { tripId } = req.params;
    try {
        const trip = await db_1.default.trip.findUnique({
            where: { id: tripId },
            select: { id: true, operatorId: true, type: true, operatorName: true, fromCity: true, toCity: true, departureTime: true },
        });
        if (!trip)
            return res.status(404).json({ message: 'Trip not found' });
        const status = await (0, liveTracking_1.getTrackingStatus)(tripId);
        const allowed = await canView(req.user, trip, req.query.tracking);
        return res.json({
            tripId,
            status,
            trip: { type: String(trip.type).toLowerCase(), operatorName: trip.operatorName, fromCity: trip.fromCity, toCity: trip.toCity, departureTime: trip.departureTime },
            canView: allowed,
            canSend: !!req.user && trip.operatorId === req.user.id,
            location: allowed && status === 'en_cours' ? (0, liveTracking_1.getLocation)(tripId) : null,
        });
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
// ─── POST /api/trips/:tripId/location ────────────
exports.router.post('/:tripId/location', exports.trackingLimiter, smallJson, auth_1.authenticate, async (req, res) => {
    const { tripId } = req.params;
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const speed = req.body?.speed != null && isFinite(Number(req.body.speed)) ? Math.max(0, Number(req.body.speed)) : null;
    const heading = req.body?.heading != null && isFinite(Number(req.body.heading)) ? Number(req.body.heading) : null;
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return res.status(400).json({ message: 'lat and lng are required numbers' });
    }
    try {
        const trip = await db_1.default.trip.findUnique({
            where: { id: tripId },
            select: { operatorId: true, type: true, operatorName: true, fromCity: true, toCity: true, departureTime: true },
        });
        if (!trip) {
            (0, liveTracking_1.endTracking)(tripId, 'annule');
            return res.status(404).json({ message: 'Trip not found', status: 'annule' });
        }
        if (trip.operatorId !== req.user.id) {
            return res.status(403).json({ message: 'Only the trip transporter can send its location' });
        }
        const status = await (0, liveTracking_1.getTrackingStatus)(tripId);
        if (status !== 'en_cours') {
            // Tells the app to stop its background task (livré / annulé / not started).
            (0, liveTracking_1.endTracking)(tripId, status);
            return res.status(409).json({ message: 'Trip is not in progress', status });
        }
        const now = new Date().toISOString();
        const loc = { lat, lng, speed, heading, updatedAt: now, timestamp: now };
        (0, liveTracking_1.publishLocation)(tripId, loc, {
            type: String(trip.type).toLowerCase(),
            operatorName: trip.operatorName,
            fromCity: trip.fromCity,
            toCity: trip.toCity,
            departureTime: trip.departureTime ? new Date(trip.departureTime).toISOString() : null,
        });
        return res.json({ success: true, ok: true, status, listeners: (0, liveTracking_1.streamCount)(tripId), mapViewers: (0, liveTracking_1.mapStreamCount)() });
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
// ─── GET /api/trips/:tripId/location/stream (SSE) ─
exports.router.get('/:tripId/location/stream', exports.trackingLimiter, auth_1.authenticate, async (req, res) => {
    const { tripId } = req.params;
    try {
        const trip = await db_1.default.trip.findUnique({ where: { id: tripId }, select: { id: true, operatorId: true } });
        if (!trip)
            return res.status(404).json({ message: 'Trip not found' });
        if (!(await canView(req.user, trip, req.query.tracking))) {
            return res.status(403).json({ message: 'Not linked to this trip' });
        }
        if ((0, liveTracking_1.streamCount)(tripId) >= liveTracking_1.MAX_STREAMS_PER_TRIP) {
            return res.status(503).json({ message: 'Too many viewers, retry later' });
        }
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no', // disable proxy buffering (Render / nginx)
        });
        res.write('retry: 5000\n\n');
        const status = await (0, liveTracking_1.getTrackingStatus)(tripId);
        (0, liveTracking_1.sendEvent)(res, 'status', { status });
        if (status !== 'en_cours') {
            (0, liveTracking_1.sendEvent)(res, 'end', { status });
            return res.end();
        }
        const last = (0, liveTracking_1.getLocation)(tripId);
        if (last)
            (0, liveTracking_1.sendEvent)(res, 'location', last);
        (0, liveTracking_1.addStream)(tripId, res);
        // Heartbeat keeps the connection alive through proxies (Render idles ~100s).
        const ping = setInterval(() => { try {
            res.write(': ping\n\n');
        }
        catch { /* ignore */ } }, 20000);
        req.on('close', () => {
            clearInterval(ping);
            (0, liveTracking_1.removeStream)(tripId, res);
        });
    }
    catch (e) {
        if (!res.headersSent)
            return res.status(500).json({ message: 'Server error' });
        try {
            res.end();
        }
        catch { /* ignore */ }
    }
});
