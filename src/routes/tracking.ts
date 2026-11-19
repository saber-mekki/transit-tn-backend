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
import express, { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import prisma from '../db';
import { authenticate, optionalAuth, AuthRequest } from '../middleware/auth';
import {
  getTrackingStatus, getLocation, publishLocation, endTracking, refreshTracking,
  startTripManually, endTripManually, getRoute, simplifyRoute,
  addStream, removeStream, sendEvent, streamCount, MAX_STREAMS_PER_TRIP,
  addMapStream, removeMapStream, mapStreamCount, liveSnapshot, MAX_MAP_STREAMS,
} from '../utils/liveTracking';

export const router = Router();

// Own limiter: these routes are registered before the global 100/15min limiter,
// because a transporter alone sends ~30 positions per 15 min.
// Applied per route (not router.use) so other /api/trips requests are untouched.
export const trackingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Override locally to run scripts/simulate-live-trips.sh at a fast pace.
  max: Number(process.env.TRACKING_RATE_LIMIT) || 400,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
});
const smallJson = express.json({ limit: '10kb' });

/** Is this (possibly anonymous) user allowed to watch the trip's position? */
export async function canView(
  user: AuthRequest['user'],
  trip: { id: string; operatorId: string },
  trackingNumber?: string,
): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'ADMIN' || trip.operatorId === user.id) return true;
  const reservation = await prisma.reservation.findFirst({
    where: { tripId: trip.id, userId: user.id, status: { not: 'REJECTED' } },
    select: { id: true },
  });
  if (reservation) return true;
  // A client who knows the tracking number of a parcel on this trip is linked to it.
  if (trackingNumber) {
    const shipment = await prisma.shipment.findFirst({
      where: { trackingNumber: trackingNumber.toUpperCase(), tripId: trip.id },
      select: { id: true },
    });
    if (shipment) return true;
  }
  return false;
}

// ─── GET /api/trips/live-map/stream (SSE, public) ─
// Feeds the public live map page: every trip currently en_cours.
// Events: snapshot [all], location {tripId,...}, remove {tripId,status}.
router.get('/live-map/stream', trackingLimiter, (req: AuthRequest, res: Response) => {
  if (mapStreamCount() >= MAX_MAP_STREAMS) {
    return res.status(503).json({ message: 'Too many viewers, retry later' });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');
  const snapshot = liveSnapshot();
  sendEvent(res, 'snapshot', snapshot);
  // Same data as individual "location" events, for clients that only listen to those.
  snapshot.forEach(loc => sendEvent(res, 'location', loc));
  addMapStream(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* ignore */ } }, 20_000);
  req.on('close', () => {
    clearInterval(ping);
    removeMapStream(res);
  });
});

// ─── GET /api/trips/tracking/mine ────────────────
// The driver's trip that should be sharing its position right now:
// a transporter trip with parcels in transit, a trip started with
// "Démarrer le trajet", or a louage/bus trip inside its departure window.
const tripSelect = { id: true, fromCity: true, toCity: true, type: true, departureTime: true } as const;
const lower = (t: any) => (t ? { ...t, type: String(t.type).toLowerCase() } : null);

router.get('/tracking/mine', trackingLimiter, authenticate, async (req: AuthRequest, res: Response) => {
  const me = req.user!.id;
  try {
    const shipment = await prisma.shipment.findFirst({
      where: { status: 'IN_TRANSIT', trip: { operatorId: me } },
      orderBy: { updatedAt: 'desc' },
      select: { trip: { select: tripSelect } },
    });
    if (shipment?.trip) return res.json({ trip: lower(shipment.trip) });

    const now = Date.now();
    const candidates = await prisma.trip.findMany({
      where: {
        operatorId: me,
        status: { not: 'COMPLETED' },
        OR: [
          // departed (or departing within 15 min) and not ended — however late
          { type: { in: ['LOUAGE', 'BUS'] }, departureTime: { lte: new Date(now + 15 * 60_000) } },
          // started by hand, whatever the date
          { liveTracking: { is: { startedAt: { not: null }, endedAt: null } } } as any,
        ],
      },
      orderBy: { departureTime: 'desc' },
      take: 10,
      select: tripSelect,
    }).catch(async () =>
      // TripTracking table not created yet: window only.
      prisma.trip.findMany({
        where: {
          operatorId: me, status: { not: 'COMPLETED' }, type: { in: ['LOUAGE', 'BUS'] },
          departureTime: { lte: new Date(now + 15 * 60_000) },
        },
        orderBy: { departureTime: 'desc' }, take: 10, select: tripSelect,
      }));
    for (const trip of candidates) {
      if ((await getTrackingStatus(trip.id)) === 'en_cours') return res.json({ trip: lower(trip) });
    }
    return res.json({ trip: null });
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// ─── POST /api/trips/:tripId/tracking/start|stop ─
async function ownTrip(req: AuthRequest, res: Response) {
  const trip = await prisma.trip.findUnique({ where: { id: req.params.tripId }, select: { id: true, operatorId: true } });
  if (!trip) { res.status(404).json({ message: 'Trip not found' }); return null; }
  if (req.user!.role !== 'ADMIN' && trip.operatorId !== req.user!.id) {
    res.status(403).json({ message: 'Only the trip driver can do this' });
    return null;
  }
  return trip;
}

router.post('/:tripId/tracking/start', trackingLimiter, authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await ownTrip(req, res))) return;
    await startTripManually(req.params.tripId);
    await refreshTracking(req.params.tripId);
    return res.json({ status: await getTrackingStatus(req.params.tripId, true) });
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/:tripId/tracking/stop', trackingLimiter, smallJson, authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await ownTrip(req, res))) return;
    const status = req.body?.status === 'annule' ? 'annule' : 'livre';
    await endTripManually(req.params.tripId, status);
    // Ending the trip is what removes it from search + live map (status-based visibility).
    await prisma.trip.update({ where: { id: req.params.tripId }, data: { status: 'COMPLETED', completedAt: new Date() } });
    await refreshTracking(req.params.tripId);
    return res.json({ status: await getTrackingStatus(req.params.tripId, true) });
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/trips/:tripId/route ────────────────
// Traveled path. Public while the trip is en_cours (the live map already shows
// the vehicle to everyone); afterwards only for users linked to the trip.
router.get('/:tripId/route', trackingLimiter, optionalAuth, async (req: AuthRequest, res: Response) => {
  const { tripId } = req.params;
  try {
    const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { id: true, operatorId: true } });
    if (!trip) return res.status(404).json({ message: 'Trip not found' });
    const status = await getTrackingStatus(tripId);
    if (status !== 'en_cours' && !(await canView(req.user, trip, req.query.tracking as string | undefined))) {
      return res.status(403).json({ message: 'Not linked to this trip' });
    }
    const points = await getRoute(tripId);
    return res.json({
      tripId,
      status,
      points: simplifyRoute(points),
      location: status === 'en_cours' ? getLocation(tripId) : null,
    });
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/trips/:tripId/tracking ─────────────
router.get('/:tripId/tracking', trackingLimiter, optionalAuth, async (req: AuthRequest, res: Response) => {
  const { tripId } = req.params;
  try {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { id: true, operatorId: true, type: true, operatorName: true, fromCity: true, toCity: true, departureTime: true },
    });
    if (!trip) return res.status(404).json({ message: 'Trip not found' });
    const status = await getTrackingStatus(tripId);
    const allowed = await canView(req.user, trip, req.query.tracking as string | undefined);
    return res.json({
      tripId,
      status,
      trip: { type: String(trip.type).toLowerCase(), operatorName: trip.operatorName, fromCity: trip.fromCity, toCity: trip.toCity, departureTime: trip.departureTime },
      canView: allowed,
      canSend: !!req.user && trip.operatorId === req.user.id,
      location: allowed && status === 'en_cours' ? getLocation(tripId) : null,
    });
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// ─── POST /api/trips/:tripId/location ────────────
router.post('/:tripId/location', trackingLimiter, smallJson, authenticate, async (req: AuthRequest, res: Response) => {
  const { tripId } = req.params;
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const speed = req.body?.speed != null && isFinite(Number(req.body.speed)) ? Math.max(0, Number(req.body.speed)) : null;
  const heading = req.body?.heading != null && isFinite(Number(req.body.heading)) ? Number(req.body.heading) : null;

  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ message: 'lat and lng are required numbers' });
  }
  try {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { operatorId: true, type: true, operatorName: true, fromCity: true, toCity: true, departureTime: true },
    });
    if (!trip) {
      endTracking(tripId, 'annule');
      return res.status(404).json({ message: 'Trip not found', status: 'annule' });
    }
    if (trip.operatorId !== req.user!.id) {
      return res.status(403).json({ message: 'Only the trip transporter can send its location' });
    }
    const status = await getTrackingStatus(tripId);
    if (status !== 'en_cours') {
      // Tells the app to stop its background task (livré / annulé / not started).
      endTracking(tripId, status);
      return res.status(409).json({ message: 'Trip is not in progress', status });
    }
    const now = new Date().toISOString();
    const loc = { lat, lng, speed, heading, updatedAt: now, timestamp: now };
    publishLocation(tripId, loc, {
      type: String(trip.type).toLowerCase(),
      operatorName: trip.operatorName,
      fromCity: trip.fromCity,
      toCity: trip.toCity,
      departureTime: trip.departureTime ? new Date(trip.departureTime).toISOString() : null,
    });
    return res.json({ success: true, ok: true, status, listeners: streamCount(tripId), mapViewers: mapStreamCount() });
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/trips/:tripId/location/stream (SSE) ─
router.get('/:tripId/location/stream', trackingLimiter, authenticate, async (req: AuthRequest, res: Response) => {
  const { tripId } = req.params;
  try {
    const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { id: true, operatorId: true } });
    if (!trip) return res.status(404).json({ message: 'Trip not found' });
    if (!(await canView(req.user, trip, req.query.tracking as string | undefined))) {
      return res.status(403).json({ message: 'Not linked to this trip' });
    }
    if (streamCount(tripId) >= MAX_STREAMS_PER_TRIP) {
      return res.status(503).json({ message: 'Too many viewers, retry later' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable proxy buffering (Render / nginx)
    });
    res.write('retry: 5000\n\n');

    const status = await getTrackingStatus(tripId);
    sendEvent(res, 'status', { status });
    if (status !== 'en_cours') {
      sendEvent(res, 'end', { status });
      return res.end();
    }
    const last = getLocation(tripId);
    if (last) sendEvent(res, 'location', last);

    addStream(tripId, res);
    // Heartbeat keeps the connection alive through proxies (Render idles ~100s).
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* ignore */ } }, 20_000);
    req.on('close', () => {
      clearInterval(ping);
      removeStream(tripId, res);
    });
  } catch (e) {
    if (!res.headersSent) return res.status(500).json({ message: 'Server error' });
    try { res.end(); } catch { /* ignore */ }
  }
});
