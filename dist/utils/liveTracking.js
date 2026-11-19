"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_MAP_STREAMS = exports.MAX_STREAMS_PER_TRIP = void 0;
exports.startTripManually = startTripManually;
exports.endTripManually = endTripManually;
exports.tripWindow = tripWindow;
exports.deriveStatus = deriveStatus;
exports.getTrackingStatus = getTrackingStatus;
exports.getTrackingStatuses = getTrackingStatuses;
exports.distanceKm = distanceKm;
exports.getRoute = getRoute;
exports.simplifyRoute = simplifyRoute;
exports.getLocation = getLocation;
exports.sendEvent = sendEvent;
exports.streamCount = streamCount;
exports.addStream = addStream;
exports.removeStream = removeStream;
exports.publishLocation = publishLocation;
exports.liveSnapshot = liveSnapshot;
exports.addMapStream = addMapStream;
exports.removeMapStream = removeMapStream;
exports.mapStreamCount = mapStreamCount;
exports.endTracking = endTracking;
exports.refreshTracking = refreshTracking;
const db_1 = __importDefault(require("../db"));
const locations = new Map();
const metas = new Map();
const streams = new Map(); // per-trip viewers
const mapStreams = new Set(); // live-map page (all trips)
// Short cache so a POST every 30s doesn't hit the DB every time.
const STATUS_TTL_MS = 15000;
const statusCache = new Map();
exports.MAX_STREAMS_PER_TRIP = 50;
exports.MAX_MAP_STREAMS = 500;
// ─── Optional DB tables ──────────────────────────
let trackingTablesOk = true;
function isMissingTable(e) {
    return e?.code === 'P2021' || e?.code === 'P2022' || /does not exist/i.test(String(e?.message || ''));
}
async function dbTry(fn, fallback) {
    if (!trackingTablesOk)
        return fallback;
    try {
        return await fn();
    }
    catch (e) {
        if (isMissingTable(e)) {
            trackingTablesOk = false;
            console.warn('[live-tracking] TripTracking/TripLocationPoint tables missing — run `npx prisma db push`. Using memory only.');
        }
        else {
            console.error('[live-tracking] DB error:', e?.message);
        }
        return fallback;
    }
}
const db = db_1.default; // new models; typed access would break builds with an old generated client
const manualCache = new Map();
async function getManual(tripId) {
    if (manualCache.has(tripId))
        return manualCache.get(tripId);
    const row = await dbTry(() => db.tripTracking.findUnique({ where: { tripId }, select: { startedAt: true, endedAt: true, endStatus: true } }), null);
    manualCache.set(tripId, row || null);
    return row || null;
}
async function saveManual(tripId, m) {
    manualCache.set(tripId, m);
    await dbTry(() => db.tripTracking.upsert({
        where: { tripId },
        create: { tripId, ...m },
        update: m,
    }), null);
}
/** Driver pressed "Démarrer le trajet". */
async function startTripManually(tripId) {
    await saveManual(tripId, { startedAt: new Date(), endedAt: null, endStatus: null });
}
/** Driver pressed "Terminer" / trip cancelled. */
async function endTripManually(tripId, status) {
    const prev = await getManual(tripId);
    await saveManual(tripId, { startedAt: prev?.startedAt || null, endedAt: new Date(), endStatus: status });
}
// Louage / bus become "en_cours" automatically 15 min before departure.
// After that they STAY en_cours — however late — until the driver ends the
// trip ("Terminer" / trip marked COMPLETED). Times are informational only.
const WINDOW_BEFORE_MS = 15 * 60 * 1000;
function tripWindow(dep) {
    return { start: dep.getTime() - WINDOW_BEFORE_MS };
}
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
 */
function deriveStatus(trip, manual, counts, now = Date.now()) {
    const manualEnded = !!manual?.endedAt && (!manual.startedAt || manual.endedAt >= manual.startedAt);
    const manualRunning = !!manual?.startedAt && !manualEnded;
    const ended = manual?.endStatus || 'livre';
    if (String(trip.type) === 'TRANSPORTER') {
        const count = (s) => counts[s] || 0;
        const total = Object.values(counts).reduce((n, c) => n + c, 0);
        if (count('IN_TRANSIT') > 0)
            return 'en_cours';
        if (total > 0 && count('RECEIVED') === 0)
            return count('DELIVERED') > 0 ? 'livre' : 'annule';
        if (manualRunning)
            return 'en_cours';
        if (manualEnded)
            return ended;
        return 'en_attente';
    }
    if (manualEnded)
        return ended;
    if (String(trip.status) === 'COMPLETED')
        return 'livre';
    if (manualRunning)
        return 'en_cours';
    return now >= tripWindow(new Date(trip.departureTime)).start ? 'en_cours' : 'en_attente';
}
/** Status of one trip (cached 15 s). Returns null when the trip doesn't exist. */
async function getTrackingStatus(tripId, fresh = false) {
    const cached = statusCache.get(tripId);
    if (!fresh && cached && Date.now() - cached.at < STATUS_TTL_MS)
        return cached.status;
    const trip = await db_1.default.trip.findUnique({
        where: { id: tripId },
        select: { id: true, type: true, status: true, departureTime: true },
    });
    let status = null;
    if (trip) {
        const counts = {};
        if (String(trip.type) === 'TRANSPORTER') {
            const groups = await db_1.default.shipment.groupBy({ by: ['status'], where: { tripId }, _count: { _all: true } });
            for (const g of groups)
                counts[g.status] = g._count._all;
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
async function getTrackingStatuses(trips) {
    const out = new Map();
    if (!trips.length)
        return out;
    const ids = trips.map(t => t.id);
    const transporterIds = trips.filter(t => String(t.type) === 'TRANSPORTER').map(t => t.id);
    const [manualRows, groups] = await Promise.all([
        dbTry(() => db.tripTracking.findMany({
            where: { tripId: { in: ids } },
            select: { tripId: true, startedAt: true, endedAt: true, endStatus: true },
        }), []),
        transporterIds.length
            ? db_1.default.shipment.groupBy({ by: ['tripId', 'status'], where: { tripId: { in: transporterIds } }, _count: { _all: true } })
            : Promise.resolve([]),
    ]);
    const manuals = new Map();
    for (const r of manualRows)
        manuals.set(r.tripId, { startedAt: r.startedAt, endedAt: r.endedAt, endStatus: r.endStatus });
    const counts = new Map();
    for (const g of groups) {
        const c = counts.get(g.tripId) || {};
        c[g.status] = g._count._all;
        counts.set(g.tripId, c);
    }
    const now = Date.now();
    for (const t of trips) {
        // In-memory manual state wins (covers a missing TripTracking table).
        const manual = manualCache.has(t.id) ? manualCache.get(t.id) : manuals.get(t.id) || null;
        const status = deriveStatus(t, manual, counts.get(t.id) || {}, now);
        out.set(t.id, status);
        statusCache.set(t.id, { status, at: now });
    }
    return out;
}
// ─── Route history ───────────────────────────────
const MAX_ROUTE_POINTS = 3000;
const MIN_ROUTE_STEP_KM = 0.03;
const SAVE_EVERY_MS = 5 * 60 * 1000;
const SAVE_EVERY_KM = 1;
const routes = new Map();
const lastSaved = new Map();
function distanceKm(a, b) {
    const R = 6371, rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
function persistPoint(tripId, loc, force = false) {
    const now = Date.now();
    const prev = lastSaved.get(tripId);
    if (!force && prev && now - prev.at < SAVE_EVERY_MS && distanceKm(prev, loc) < SAVE_EVERY_KM)
        return;
    if (prev && prev.lat === loc.lat && prev.lng === loc.lng)
        return;
    lastSaved.set(tripId, { lat: loc.lat, lng: loc.lng, at: now });
    // Fire and forget: tracking must never wait on the DB.
    dbTry(() => db.tripLocationPoint.create({
        data: { tripId, lat: loc.lat, lng: loc.lng, speed: loc.speed, recordedAt: new Date(loc.updatedAt) },
    }), null);
}
function recordPoint(tripId, loc) {
    let r = routes.get(tripId);
    if (!r) {
        r = { points: [], loaded: false };
        routes.set(tripId, r);
    }
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
async function getRoute(tripId) {
    let r = routes.get(tripId);
    if (r?.loaded)
        return r.points;
    const saved = await dbTry(() => db.tripLocationPoint.findMany({
        where: { tripId },
        orderBy: { recordedAt: 'asc' },
        take: 5000,
        select: { lat: true, lng: true, recordedAt: true },
    }), []);
    const fromDb = saved.map(p => [p.lat, p.lng, new Date(p.recordedAt).getTime()]);
    // Memory has every point since this process started; the DB fills in what
    // happened before (e.g. after a restart).
    const mem = routes.get(tripId)?.points || [];
    const firstMem = mem.length ? mem[0][2] : Infinity;
    r = { points: [...fromDb.filter(p => p[2] < firstMem), ...mem], loaded: true };
    // Only cache trips that are live (others are read once and dropped).
    if (locations.has(tripId))
        routes.set(tripId, r);
    return r.points;
}
/** At most `max` points, evenly sampled, always keeping the last one. */
function simplifyRoute(points, max = 800) {
    if (points.length <= max)
        return points.map(p => [p[0], p[1]]);
    const step = points.length / max;
    const out = [];
    for (let i = 0; i < max - 1; i++) {
        const p = points[Math.floor(i * step)];
        out.push([p[0], p[1]]);
    }
    const last = points[points.length - 1];
    out.push([last[0], last[1]]);
    return out;
}
function getLocation(tripId) {
    return locations.get(tripId) || null;
}
function write(res, event, data) {
    try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
    catch { /* socket gone */ }
}
function sendEvent(res, event, data) {
    write(res, event, data);
}
function streamCount(tripId) {
    return streams.get(tripId)?.size || 0;
}
function addStream(tripId, res) {
    let set = streams.get(tripId);
    if (!set) {
        set = new Set();
        streams.set(tripId, set);
    }
    set.add(res);
}
function removeStream(tripId, res) {
    const set = streams.get(tripId);
    if (!set)
        return;
    set.delete(res);
    if (set.size === 0)
        streams.delete(tripId);
}
function publishLocation(tripId, loc, meta) {
    locations.set(tripId, loc);
    recordPoint(tripId, loc);
    if (meta)
        metas.set(tripId, meta);
    streams.get(tripId)?.forEach(res => write(res, 'location', loc));
    if (mapStreams.size) {
        const payload = { tripId, ...loc, trip: metas.get(tripId) || null };
        mapStreams.forEach(res => write(res, 'location', payload));
    }
}
// ─── Live map (all trips) ────────────────────────
function liveSnapshot() {
    return [...locations.entries()].map(([tripId, loc]) => ({ tripId, ...loc, trip: metas.get(tripId) || null }));
}
function addMapStream(res) { mapStreams.add(res); }
function removeMapStream(res) { mapStreams.delete(res); }
function mapStreamCount() { return mapStreams.size; }
function broadcastRemove(tripId, status) {
    mapStreams.forEach(res => write(res, 'remove', { tripId, status }));
}
/** Free memory for a trip and close its streams with a final status event. */
function endTracking(tripId, status) {
    const last = locations.get(tripId);
    if (last && status !== 'annule')
        persistPoint(tripId, last, true); // keep the arrival point
    routes.delete(tripId);
    lastSaved.delete(tripId);
    const hadLocation = locations.delete(tripId);
    metas.delete(tripId);
    if (hadLocation)
        broadcastRemove(tripId, status);
    const set = streams.get(tripId);
    if (set) {
        set.forEach(res => {
            write(res, 'end', { status });
            try {
                res.end();
            }
            catch { /* ignore */ }
        });
        streams.delete(tripId);
    }
}
/**
 * Call after anything that may change a trip's shipment statuses.
 * Recomputes the status and, if the trip is no longer en_cours
 * (livré / annulé / back to waiting / deleted), wipes its live data.
 */
async function refreshTracking(tripId) {
    if (!tripId)
        return;
    try {
        const status = await getTrackingStatus(tripId, true);
        if (status === 'en_cours') {
            streams.get(tripId)?.forEach(res => write(res, 'status', { status }));
        }
        else {
            endTracking(tripId, status);
        }
    }
    catch (e) {
        console.error('refreshTracking error:', e.message);
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
    for (const tripId of routes.keys())
        if (!locations.has(tripId))
            routes.delete(tripId);
    if (manualCache.size > 5000)
        manualCache.clear();
    for (const [tripId, c] of statusCache) {
        if (now - c.at > STATUS_TTL_MS * 4)
            statusCache.delete(tripId);
    }
}, 10 * 60 * 1000).unref();
