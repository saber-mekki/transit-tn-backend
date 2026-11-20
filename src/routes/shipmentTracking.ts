// ─── PARCEL TRACKING BY NUMBER (public) ──────────────────────────────
//   GET /api/tracking/:trackingNumber         → parcel + trip + live position + traveled path
//   GET /api/tracking/:trackingNumber/stream  → SSE: location / status / end
// Knowing the tracking number is the access key (like any courier). Only
// non-personal fields are returned: no names, no phone numbers.
import { Router, Response } from 'express';
import prisma from '../db';
import { AuthRequest } from '../middleware/auth';
import { trackingLimiter } from './tracking';
import {
  getTrackingStatus, getLocation, getRoute, simplifyRoute, syncParcelsWithTrip, getStartedAt,
  addStream, removeStream, sendEvent, streamCount, MAX_STREAMS_PER_TRIP,
} from '../utils/liveTracking';

export const router = Router();

const normalize = (n: string) => String(n || '').trim().toUpperCase().slice(0, 40);

async function loadTracking(trackingNumber: string) {
  const shipment = await prisma.shipment.findUnique({
    where: { trackingNumber: normalize(trackingNumber) },
    select: {
      trackingNumber: true, status: true, description: true, fromCity: true, toCity: true,
      weight: true, createdAt: true, updatedAt: true, tripId: true,
      operator: { select: { displayName: true } },
    },
  });
  if (!shipment) return null;

  const trip = shipment.tripId
    ? await prisma.trip.findUnique({
        where: { id: shipment.tripId },
        select: { id: true, type: true, fromCity: true, toCity: true, departureTime: true, arrivalTime: true, operatorName: true },
      })
    : null;
  const tripStatus = trip ? await getTrackingStatus(trip.id) : null;
  // Trip already running but this parcel still "enregistré" (e.g. started before the
  // parcel sync existed): bring the trip's parcels up to date now.
  if (trip && tripStatus === 'en_cours' && shipment.status === 'RECEIVED') {
    await syncParcelsWithTrip(trip.id, 'start');
    shipment.status = 'IN_TRANSIT';
  }
  const transportStartedAt = trip && shipment.status !== 'RECEIVED'
    ? (await getStartedAt(trip.id)) || (tripStatus === 'en_cours' ? trip.departureTime : null)
    : null;
  const live = !!trip && tripStatus === 'en_cours' && shipment.status === 'IN_TRANSIT';
  const showRoute = !!trip && (shipment.status === 'IN_TRANSIT' || shipment.status === 'DELIVERED');
  const route = showRoute ? simplifyRoute(await getRoute(trip!.id)) : [];

  const { operator, tripId, ...rest } = shipment;
  return {
    shipment: {
      ...rest,
      operatorName: operator?.displayName || trip?.operatorName || null,
      // No deliveredAt column: the last update of a delivered parcel is its delivery.
      deliveredAt: shipment.status === 'DELIVERED' ? shipment.updatedAt : null,
      transportStartedAt,
    },
    trip: trip ? { ...trip, type: String(trip.type).toLowerCase() } : null,
    tripStatus,
    live,
    location: live ? getLocation(trip!.id) : null,
    route,
  };
}

router.get('/:trackingNumber', trackingLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const data = await loadTracking(req.params.trackingNumber);
    if (!data) return res.status(404).json({ message: 'Colis introuvable' });
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:trackingNumber/stream', trackingLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { trackingNumber: normalize(req.params.trackingNumber) },
      select: { status: true, tripId: true },
    });
    if (!shipment) return res.status(404).json({ message: 'Colis introuvable' });
    const tripId = shipment.tripId;
    if (tripId && streamCount(tripId) >= MAX_STREAMS_PER_TRIP) {
      return res.status(503).json({ message: 'Too many viewers, retry later' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');

    const status = tripId ? await getTrackingStatus(tripId) : null;
    if (tripId && status === 'en_cours' && shipment.status === 'RECEIVED') {
      await syncParcelsWithTrip(tripId, 'start');
      shipment.status = 'IN_TRANSIT';
    }
    sendEvent(res, 'status', { status, shipmentStatus: shipment.status });
    if (!tripId || status !== 'en_cours' || shipment.status !== 'IN_TRANSIT') {
      sendEvent(res, 'end', { status, shipmentStatus: shipment.status });
      return res.end();
    }
    const last = getLocation(tripId);
    if (last) sendEvent(res, 'location', last);

    // Same channel as the trip's viewers: location, status (a parcel changed), end.
    addStream(tripId, res);
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
