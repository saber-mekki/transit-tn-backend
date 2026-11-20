// ─── LIVE TRACKING ───────────────────────────────────────────────────
// Latest driver position per trip + SSE subscribers, in memory (fast).
// Route history is kept in memory too and saved to the DB every 5 min / ~1 km
// (TripLocationPoint) so the traveled path survives a restart.
// Single-instance only (Render free tier).
//
// The two tracking tables are optional at runtime: if they don't exist yet
// (schema not pushed), everything keeps working from memory only.
import { Response } from 'express';
import prisma from '../db';

export type TrackingStatus = 'en_attente' | 'en_cours' | 'livre' | 'annule';

export interface LiveLocation {
  lat: number;
  lng: number;
  speed: number | null;   // m/s
  heading: number | null; // degrees
  updatedAt: string;      // ISO
  timestamp?: string;     // same as updatedAt (field name used by external clients)
}

/** Public trip info sent with live-map updates (so the map can show trips it didn't load). */
export interface LiveTripMeta {
  type: string;           // louage | bus | transporter
  operatorName: string;
  fromCity: string;
  toCity: string;
  departureTime?: string | null;
}

/** [lat, lng, epoch ms] */
export type RoutePoint = [number, number, number];

const locations = new Map<string, LiveLocation>();
const metas = new Map<string, LiveTripMeta>();
const streams = new Map<string, Set<Response>>();   // per-trip viewers
const mapStreams = new Set<Response>();              // live-map page (all trips)

// Short cache so a POST every 30s doesn't hit the DB every time.
const STATUS_TTL_MS = 15_000;
const statusCache = new Map<string, { status: TrackingStatus | null; at: number }>();

export const MAX_STREAMS_PER_TRIP = 50;
export const MAX_MAP_STREAMS = 500;

// ─── Optional DB tables ──────────────────────────
let trackingTablesOk = true;
function isMissingTable(e: any) {
  return e?.code === 'P2021' || e?.code === 'P2022' || /does not exist/i.test(String(e?.message || ''));
}
async function dbTry<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!trackingTablesOk) return fallback;
  try {
    return await fn();
  } catch (e: any) {
    if (isMissingTable(e)) {
      trackingTablesOk = false;
      console.warn('[live-tracking] TripTracking/TripLocationPoint tables missing — run `npx prisma db push`. Using memory only.');
    } else {
      console.error('[live-tracking] DB error:', e?.message);
    }
    return fallback;
  }
}
const db: any = prisma; // new models; typed access would break builds with an old generated client

// ─── Manual start / end (louage, bus — and transporter without parcels) ─
type Manual = { startedAt: Date | null; endedAt: Date | null; endStatus: string | null };
const manualCache = new Map<string, Manual | null>();

async function getManual(tripId: string): Promise<Manual | null> {
  if (manualCache.has(tripId)) return manualCache.get(tripId)!;
  const row = await dbTry(
    () => db.tripTracking.findUnique({ where: { tripId }, select: { startedAt: true, endedAt: true, endStatus: true } }),
    null,
  );
  manualCache.set(tripId, row || null);
  return row || null;
}

async function saveManual(tripId: string, m: Manual) {
  manualCache.set(tripId, m);
  await dbTry(() => db.tripTracking.upsert({
    where: { tripId },
    create: { tripId, ...m },
    update: m,
  }), null);
}

/** Driver pressed "Démarrer le trajet". */
export async function startTripManually(tripId: string) {
  await saveManual(tripId, { startedAt: new Date(), endedAt: null, endStatus: null });
}
/** Driver pressed "Terminer" / trip cancelled. */
export async function endTripManually(tripId: string, status: 'livre' | 'annule') {
  const prev = await getManual(tripId);
  await saveManual(tripId, { startedAt: prev?.startedAt || null, endedAt: new Date(), endStatus: status });
}

// Louage / bus become "en_cours" automatically 15 min before departure.
// After that they STAY en_cours — however late — until the driver ends the
// trip ("Terminer" / trip marked COMPLETED). Times are informational only.
const WINDOW_BEFORE_MS = 15 * 60 * 1000;
export function tripWindow(dep: Date) {
  return { start: dep.getTime() - WINDOW_BEFORE_MS };
}

type StatusTrip = {
  id: string; type: any; status: any; departureTime: Date | string;
  operatorName?: string | null; operator?: { role?: any } | null;
};

/**
 * Admin timetable trips (public schedules imported by an admin, e.g. SNTRI buses)
 * are informational only: never "en_cours", never LIVE, never on the live map.
 */
export function isTimetableTrip(trip: { operatorName?: string | null; operator?: { role?: any } | null }) {
  return String(trip.operator?.role || '') === 'ADMIN' || String(trip.operatorName || '').trim().toLowerCase() === 'admin';
}
type ShipmentCounts = Record<string, number>; // shipment status → count

/**
 * Trip tracking status — derived from statuses only, never from elapsed time:
 *  TRANSPORTER — from its parcels:
 *   - en_cours   → at least one shipment IN_TRANSIT (or started manually while parcels wait)
 *   - livre      → every shipment closed, at least one DELIVERED
 *   - annule     → every shipment CANCELLED
 *   - en_attente → otherwise
 *  LOUAGE / BUS — from the driver's buttons (+ automatic start at departure):
 *   - livre/annule → "Terminer" pressed, or trip marked COMPLETED
 *   - en_cours     → "Démarrer" pressed, or departure time reached (stays en_cours if late)
 *   - en_attente   → before departure
 *  Admin timetable trips: always en_attente (informational) unless ended.
 */
export function deriveStatus(trip: StatusTrip, manual: Manual | null, counts: ShipmentCounts, now = Date.now()): TrackingStatus {
  const manualEnded = !!manual?.endedAt && (!manual.startedAt || manual.endedAt >= manual.startedAt);
  const manualRunning = !!manual?.startedAt && !manualEnded;
  const ended = (manual?.endStatus as TrackingStatus) || 'livre';

  if (String(trip.type) === 'TRANSPORTER') {
    const count = (s: string) => counts[s] || 0;
    const total = Object.values(counts).reduce((n, c) => n + c, 0);
    if (count('IN_TRANSIT') > 0) return 'en_cours';
    if (total > 0 && count('RECEIVED') === 0) return count('DELIVERED') > 0 ? 'livre' : 'annule';
    if (manualRunning) return 'en_cours';
    if (manualEnded) return ended;
    return 'en_attente';
  }
  if (manualEnded) return ended;
  if (String(trip.status) === 'COMPLETED') return 'livre';
  if (isTimetableTrip(trip)) return 'en_attente';
  if (manualRunning) return 'en_cours';
  return now >= tripWindow(new Date(trip.departureTime)).start ? 'en_cours' : 'en_attente';
}

/** Status of one trip (cached 15 s). Returns null when the trip doesn't exist. */
export async function getTrackingStatus(tripId: string, fresh = false): Promise<TrackingStatus | null> {
  const cached = statusCache.get(tripId);
  if (!fresh && cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.status;

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { id: true, type: true, status: true, departureTime: true, operatorName: true, operator: { select: { role: true } } },
  });
  let status: TrackingStatus | null = null;
  if (trip) {
    const counts: ShipmentCounts = {};
    if (String(trip.type) === 'TRANSPORTER') {
      const groups = await prisma.shipment.groupBy({ by: ['status'], where: { tripId }, _count: { _all: true } });
      for (const g of groups) counts[g.status] = g._count._all;
    }
    status = deriveStatus(trip, await getManual(tripId), counts);
  }
  statusCache.set(tripId, { status, at: Date.now() });
  return status;
}

/**
 * Same as getTrackingStatus for a whole list, in 2 queries (trip lists, search).
 * Returns tripId → status.
 */
export async function getTrackingStatuses(trips: StatusTrip[]): Promise<Map<string, TrackingStatus>> {
  const out = new Map<string, TrackingStatus>();
  if (!trips.length) return out;
  const ids = trips.map(t => t.id);
  const transporterIds = trips.filter(t => String(t.type) === 'TRANSPORTER').map(t => t.id);

  const [manualRows, groups] = await Promise.all([
    dbTry(() => db.tripTracking.findMany({
      where: { tripId: { in: ids } },
      select: { tripId: true, startedAt: true, endedAt: true, endStatus: true },
    }), [] as any[]),
    transporterIds.length
      ? prisma.shipment.groupBy({ by: ['tripId', 'status'], where: { tripId: { in: transporterIds } }, _count: { _all: true } })
      : Promise.resolve([] as any[]),
  ]);
  const manuals = new Map<string, Manual>();
  for (const r of manualRows as any[]) manuals.set(r.tripId, { startedAt: r.startedAt, endedAt: r.endedAt, endStatus: r.endStatus });
  const counts = new Map<string, ShipmentCounts>();
  for (const g of groups as any[]) {
    const c = counts.get(g.tripId) || {};
    c[g.status] = g._count._all;
    counts.set(g.tripId, c);
  }
  const now = Date.now();
  for (const t of trips) {
    // In-memory manual state wins (covers a missing TripTracking table).
    const manual = manualCache.has(t.id) ? manualCache.get(t.id)! : manuals.get(t.id) || null;
    const status = deriveStatus(t, manual, counts.get(t.id) || {}, now);
    out.set(t.id, status);
    statusCache.set(t.id, { status, at: now });
  }
  return out;
}

// ─── Auto-cleanup (safety net) ───────────────────
// Regular trips whose arrival is more than 14 days in the past and that the
// driver never ended are marked COMPLETED. Admin timetables are never touched.
export const STALE_TRIP_DAYS = 14;
const CLEANUP_EVERY_MS = 10 * 60 * 1000;
let lastCleanup = 0;
let cleanupRunning: Promise<number> | null = null;
export function autoCloseStaleTrips(force = false): Promise<number> {
  if (cleanupRunning) return cleanupRunning;
  if (!force && Date.now() - lastCleanup < CLEANUP_EVERY_MS) return Promise.resolve(0);
  lastCleanup = Date.now();
  cleanupRunning = (async () => {
    try {
      const cutoff = new Date(Date.now() - STALE_TRIP_DAYS * 24 * 3600_000);
      const stale = await prisma.trip.findMany({
        where: {
          status: { not: 'COMPLETED' },
          arrivalTime: { lt: cutoff },
          operator: { role: { not: 'ADMIN' } },
          NOT: { operatorName: { equals: 'admin', mode: 'insensitive' } },
        },
        select: { id: true },
        take: 500,
      });
      if (!stale.length) return 0;
      const ids = stale.map(t => t.id);
      await prisma.trip.updateMany({ where: { id: { in: ids } }, data: { status: 'COMPLETED', completedAt: new Date() } });
      for (const id of ids) { statusCache.delete(id); if (locations.has(id)) endTracking(id, 'livre'); }
      console.log(`[live-tracking] auto-closed ${ids.length} trip(s) ended > ${STALE_TRIP_DAYS} days ago`);
      return ids.length;
    } catch (e: any) {
      console.error('[live-tracking] auto-cleanup failed:', e?.message);
      return 0;
    } finally {
      cleanupRunning = null;
    }
  })();
  return cleanupRunning;
}
setInterval(() => { autoCloseStaleTrips(); }, 60 * 60 * 1000).unref();

// ─── Route history ───────────────────────────────
const MAX_ROUTE_POINTS = 3000;
const MIN_ROUTE_STEP_KM = 0.03;
const SAVE_EVERY_MS = 5 * 60 * 1000;
const SAVE_EVERY_KM = 1;
const routes = new Map<string, { points: RoutePoint[]; loaded: boolean }>();
const lastSaved = new Map<string, { lat: number; lng: number; at: number }>();

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function persistPoint(tripId: string, loc: LiveLocation, force = false) {
  const now = Date.now();
  const prev = lastSaved.get(tripId);
  if (!force && prev && now - prev.at < SAVE_EVERY_MS && distanceKm(prev, loc) < SAVE_EVERY_KM) return;
  if (prev && prev.lat === loc.lat && prev.lng === loc.lng) return;
  lastSaved.set(tripId, { lat: loc.lat, lng: loc.lng, at: now });
  // Fire and forget: tracking must never wait on the DB.
  dbTry(() => db.tripLocationPoint.create({
    data: { tripId, lat: loc.lat, lng: loc.lng, speed: loc.speed, recordedAt: new Date(loc.updatedAt) },
  }), null);
}

function recordPoint(tripId: string, loc: LiveLocation) {
  let r = routes.get(tripId);
  if (!r) { r = { points: [], loaded: false }; routes.set(tripId, r); }
  const last = r.points[r.points.length - 1];
  if (!last || distanceKm({ lat: last[0], lng: last[1] }, loc) >= MIN_ROUTE_STEP_KM) {
    r.points.push([loc.lat, loc.lng, new Date(loc.updatedAt).getTime()]);
    if (r.points.length > MAX_ROUTE_POINTS) {
      // Halve the resolution, keep the newest point.
      r.points = r.points.filter((_, i, a) => i % 2 === 0 || i === a.length - 1);
    }
  }
  persistPoint(tripId, loc);
}

/** Traveled path (oldest → newest). Loads saved points after a restart. */
export async function getRoute(tripId: string): Promise<RoutePoint[]> {
  let r = routes.get(tripId);
  if (r?.loaded) return r.points;
  const saved: any[] = await dbTry(() => db.tripLocationPoint.findMany({
    where: { tripId },
    orderBy: { recordedAt: 'asc' },
    take: 5000,
    select: { lat: true, lng: true, recordedAt: true },
  }), []);
  const fromDb: RoutePoint[] = saved.map(p => [p.lat, p.lng, new Date(p.recordedAt).getTime()]);
  // Memory has every point since this process started; the DB fills in what
  // happened before (e.g. after a restart).
  const mem = routes.get(tripId)?.points || [];
  const firstMem = mem.length ? mem[0][2] : Infinity;
  r = { points: [...fromDb.filter(p => p[2] < firstMem), ...mem], loaded: true };
  // Only cache trips that are live (others are read once and dropped).
  if (locations.has(tripId)) routes.set(tripId, r);
  return r.points;
}

/** At most `max` points, evenly sampled, always keeping the last one. */
export function simplifyRoute(points: RoutePoint[], max = 800): [number, number][] {
  if (points.length <= max) return points.map(p => [p[0], p[1]]);
  const step = points.length / max;
  const out: [number, number][] = [];
  for (let i = 0; i < max - 1; i++) { const p = points[Math.floor(i * step)]; out.push([p[0], p[1]]); }
  const last = points[points.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

export function getLocation(tripId: string): LiveLocation | null {
  return locations.get(tripId) || null;
}

function write(res: Response, event: string, data: unknown) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* socket gone */ }
}

export function sendEvent(res: Response, event: string, data: unknown) {
  write(res, event, data);
}

export function streamCount(tripId: string): number {
  return streams.get(tripId)?.size || 0;
}

export function addStream(tripId: string, res: Response) {
  let set = streams.get(tripId);
  if (!set) { set = new Set(); streams.set(tripId, set); }
  set.add(res);
}

export function removeStream(tripId: string, res: Response) {
  const set = streams.get(tripId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) streams.delete(tripId);
}

export function publishLocation(tripId: string, loc: LiveLocation, meta?: LiveTripMeta) {
  locations.set(tripId, loc);
  recordPoint(tripId, loc);
  if (meta) metas.set(tripId, meta);
  streams.get(tripId)?.forEach(res => write(res, 'location', loc));
  if (mapStreams.size) {
    const payload = { tripId, ...loc, trip: metas.get(tripId) || null };
    mapStreams.forEach(res => write(res, 'location', payload));
  }
}

// ─── Live map (all trips) ────────────────────────
export function liveSnapshot() {
  return [...locations.entries()].map(([tripId, loc]) => ({ tripId, ...loc, trip: metas.get(tripId) || null }));
}
export function addMapStream(res: Response) { mapStreams.add(res); }
export function removeMapStream(res: Response) { mapStreams.delete(res); }
export function mapStreamCount() { return mapStreams.size; }

function broadcastRemove(tripId: string, status: TrackingStatus | null) {
  mapStreams.forEach(res => write(res, 'remove', { tripId, status }));
}

/** Free memory for a trip and close its streams with a final status event. */
export function endTracking(tripId: string, status: TrackingStatus | null) {
  const last = locations.get(tripId);
  if (last && status !== 'annule') persistPoint(tripId, last, true); // keep the arrival point
  routes.delete(tripId);
  lastSaved.delete(tripId);
  const hadLocation = locations.delete(tripId);
  metas.delete(tripId);
  if (hadLocation) broadcastRemove(tripId, status);
  const set = streams.get(tripId);
  if (set) {
    set.forEach(res => {
      write(res, 'end', { status });
      try { res.end(); } catch { /* ignore */ }
    });
    streams.delete(tripId);
  }
}

/**
 * Call after anything that may change a trip's shipment statuses.
 * Recomputes the status and, if the trip is no longer en_cours
 * (livré / annulé / back to waiting / deleted), wipes its live data.
 */
export async function refreshTracking(tripId: string | null | undefined) {
  if (!tripId) return;
  try {
    const status = await getTrackingStatus(tripId, true);
    if (status === 'en_cours') {
      streams.get(tripId)?.forEach(res => write(res, 'status', { status }));
    } else {
      endTracking(tripId, status);
    }
  } catch (e) {
    console.error('refreshTracking error:', (e as Error).message);
  }
}

// Safety net: drop positions not refreshed for 2h when nobody is watching.
const STALE_MS = 2 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [tripId, loc] of locations) {
    if (now - new Date(loc.updatedAt).getTime() > STALE_MS && streamCount(tripId) === 0) {
      locations.delete(tripId);
      metas.delete(tripId);
      routes.delete(tripId);
      lastSaved.delete(tripId);
      broadcastRemove(tripId, null);
    }
  }
  for (const tripId of routes.keys()) if (!locations.has(tripId)) routes.delete(tripId);
  if (manualCache.size > 5000) manualCache.clear();
  for (const [tripId, c] of statusCache) {
    if (now - c.at > STATUS_TTL_MS * 4) statusCache.delete(tripId);
  }
}, 10 * 60 * 1000).unref();
