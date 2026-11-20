"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
// ─── PARCEL TRACKING BY NUMBER (public) ──────────────────────────────
//   GET /api/tracking/:trackingNumber         → parcel + trip + live position + traveled path
//   GET /api/tracking/:trackingNumber/stream  → SSE: location / status / end
// Knowing the tracking number is the access key (like any courier). Only
// non-personal fields are returned: no names, no phone numbers.
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const tracking_1 = require("./tracking");
const liveTracking_1 = require("../utils/liveTracking");
exports.router = (0, express_1.Router)();
const normalize = (n) => String(n || '').trim().toUpperCase().slice(0, 40);
async function loadTracking(trackingNumber) {
    const shipment = await db_1.default.shipment.findUnique({
        where: { trackingNumber: normalize(trackingNumber) },
        select: {
            trackingNumber: true, status: true, description: true, fromCity: true, toCity: true,
            weight: true, createdAt: true, updatedAt: true, tripId: true,
            operator: { select: { displayName: true } },
        },
    });
    if (!shipment)
        return null;
    const trip = shipment.tripId
        ? await db_1.default.trip.findUnique({
            where: { id: shipment.tripId },
            select: { id: true, type: true, fromCity: true, toCity: true, departureTime: true, arrivalTime: true, operatorName: true },
        })
        : null;
    const tripStatus = trip ? await (0, liveTracking_1.getTrackingStatus)(trip.id) : null;
    // Trip already running but this parcel still "enregistré" (e.g. started before the
    // parcel sync existed): bring the trip's parcels up to date now.
    if (trip && tripStatus === 'en_cours' && shipment.status === 'RECEIVED') {
        await (0, liveTracking_1.syncParcelsWithTrip)(trip.id, 'start');
        shipment.status = 'IN_TRANSIT';
    }
    const transportStartedAt = trip && shipment.status !== 'RECEIVED'
        ? (await (0, liveTracking_1.getStartedAt)(trip.id)) || (tripStatus === 'en_cours' ? trip.departureTime : null)
        : null;
    const live = !!trip && tripStatus === 'en_cours' && shipment.status === 'IN_TRANSIT';
    const showRoute = !!trip && (shipment.status === 'IN_TRANSIT' || shipment.status === 'DELIVERED');
    const route = showRoute ? (0, liveTracking_1.simplifyRoute)(await (0, liveTracking_1.getRoute)(trip.id)) : [];
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
        location: live ? (0, liveTracking_1.getLocation)(trip.id) : null,
        route,
    };
}
exports.router.get('/:trackingNumber', tracking_1.trackingLimiter, async (req, res) => {
    try {
        const data = await loadTracking(req.params.trackingNumber);
        if (!data)
            return res.status(404).json({ message: 'Colis introuvable' });
        return res.json(data);
    }
    catch (e) {
        return res.status(500).json({ message: 'Server error' });
    }
});
exports.router.get('/:trackingNumber/stream', tracking_1.trackingLimiter, async (req, res) => {
    try {
        const shipment = await db_1.default.shipment.findUnique({
            where: { trackingNumber: normalize(req.params.trackingNumber) },
            select: { status: true, tripId: true },
        });
        if (!shipment)
            return res.status(404).json({ message: 'Colis introuvable' });
        const tripId = shipment.tripId;
        if (tripId && (0, liveTracking_1.streamCount)(tripId) >= liveTracking_1.MAX_STREAMS_PER_TRIP) {
            return res.status(503).json({ message: 'Too many viewers, retry later' });
        }
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.write('retry: 5000\n\n');
        const status = tripId ? await (0, liveTracking_1.getTrackingStatus)(tripId) : null;
        if (tripId && status === 'en_cours' && shipment.status === 'RECEIVED') {
            await (0, liveTracking_1.syncParcelsWithTrip)(tripId, 'start');
            shipment.status = 'IN_TRANSIT';
        }
        (0, liveTracking_1.sendEvent)(res, 'status', { status, shipmentStatus: shipment.status });
        if (!tripId || status !== 'en_cours' || shipment.status !== 'IN_TRANSIT') {
            (0, liveTracking_1.sendEvent)(res, 'end', { status, shipmentStatus: shipment.status });
            return res.end();
        }
        const last = (0, liveTracking_1.getLocation)(tripId);
        if (last)
            (0, liveTracking_1.sendEvent)(res, 'location', last);
        // Same channel as the trip's viewers: location, status (a parcel changed), end.
        (0, liveTracking_1.addStream)(tripId, res);
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
