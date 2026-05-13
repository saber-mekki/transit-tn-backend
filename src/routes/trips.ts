import { Router, Request, Response } from 'express';
import { TransportType } from '@prisma/client';
import prisma from '../db';
import { authenticate, requireOperator, AuthRequest } from '../middleware/auth';

export const router = Router();

const INCLUDE_ALL = {
  louageTrip: { include: { station: true } },
  busTrip: { include: { departureStation: true, arrivalStation: true } },
  transporterTrip: true,
};

function formatTrip(trip: any) {
  if (!trip) return null;
  const { louageTrip, busTrip, transporterTrip, ...base } = trip;
  let extra: any = {};
  if (trip.type === 'LOUAGE' && louageTrip) extra = louageTrip;
  else if (trip.type === 'BUS' && busTrip) extra = busTrip;
  else if (trip.type === 'TRANSPORTER' && transporterTrip) extra = transporterTrip;
  // IMPORTANT: preserve base trip id, not sub-table id
  const { id: _subId, ...extraWithoutId } = extra;
  return { ...base, type: base.type.toLowerCase(), ...extraWithoutId };
}

// ─── GET /api/trips ──────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const { type, fromCity, toCity } = req.query;
  const where: any = {};
  if (type) where.type = (type as string).toUpperCase() as TransportType;
  if (fromCity) where.fromCity = { contains: fromCity as string, mode: 'insensitive' };
  if (toCity)   where.toCity   = { contains: toCity   as string, mode: 'insensitive' };
  try {
    const trips = await prisma.trip.findMany({ where, include: INCLUDE_ALL, orderBy: { departureTime: 'asc' } });
    return res.json(trips.map(formatTrip));
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching trips' });
  }
});

// ─── GET /api/trips/:id ──────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const trip = await prisma.trip.findUnique({ where: { id: req.params.id }, include: INCLUDE_ALL });
    if (!trip) return res.status(404).json({ message: 'Trip not found' });
    return res.json(formatTrip(trip));
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching trip' });
  }
});

// ─── POST /api/trips ─────────────────────────────
router.post('/', authenticate, requireOperator, async (req: AuthRequest, res: Response) => {
  const { type, fromCity, toCity, departureTime, arrivalTime, ...details } = req.body;
  if (!type || !fromCity || !toCity || !departureTime) {
    return res.status(400).json({ message: 'type, fromCity, toCity, departureTime are required' });
  }
  try {
    const operatorId  = req.user!.id;
    const operator    = await prisma.user.findUnique({ where: { id: operatorId } });
    if (!operator) return res.status(404).json({ message: 'Operator not found' });
    const tripType    = type.toUpperCase() as TransportType;
    const dt          = new Date(departureTime);
    const at          = arrivalTime ? new Date(arrivalTime) : dt;
    let newTrip: any;

    if (tripType === TransportType.LOUAGE) {
      const { price, totalSeats, customStationName, vehicleNumber, contactInfo } = details;
      newTrip = await prisma.trip.create({
        data: {
          type: TransportType.LOUAGE, operatorId, operatorName: operator.displayName,
          fromCity, toCity, departureTime: dt, arrivalTime: at,
          louageTrip: { create: {
            price: Number(price) || 0, totalSeats: Number(totalSeats) || 8,
            availableSeats: Number(totalSeats) || 8, isFull: false,
            customStationName: customStationName || null,
            vehicleNumber: vehicleNumber || null,
            contactInfo: contactInfo || null,
          }},
        }, include: INCLUDE_ALL,
      });
    } else if (tripType === TransportType.BUS) {
      const { price, totalSeats, customStationName } = details;
      newTrip = await prisma.trip.create({
        data: {
          type: TransportType.BUS, operatorId, operatorName: operator.displayName,
          fromCity, toCity, departureTime: dt, arrivalTime: at,
          busTrip: { create: {
            price: Number(price) || 0, totalSeats: Number(totalSeats) || 8,
            availableSeats: Number(totalSeats) || 8,
            customDepartureStationName: customStationName || null,
          }},
        }, include: INCLUDE_ALL,
      });
    } else if (tripType === TransportType.TRANSPORTER) {
      const { contactInfo, vehicleType, availableSpace, eta, route } = details;
      newTrip = await prisma.trip.create({
        data: {
          type: TransportType.TRANSPORTER, operatorId, operatorName: operator.displayName,
          fromCity, toCity, departureTime: dt, arrivalTime: at,
          transporterTrip: { create: {
            contactInfo: contactInfo || '', vehicleType: vehicleType || '',
            availableSpace: availableSpace || '', eta: eta || '',
            route: route || [],
          }},
        }, include: INCLUDE_ALL,
      });
    } else {
      return res.status(400).json({ message: 'Invalid trip type' });
    }
    return res.status(201).json(formatTrip(newTrip));
  } catch (error: any) {
    console.error('POST trip error:', error.message);
    return res.status(500).json({ message: error.message || 'Error creating trip' });
  }
});

// ─── PUT /api/trips/:id ──────────────────────────
router.put('/:id', authenticate, requireOperator, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    // IMPORTANT: include INCLUDE_ALL to get type-specific sub-tables
    const trip = await prisma.trip.findUnique({ where: { id }, include: INCLUDE_ALL });
    if (!trip) return res.status(404).json({ message: 'Trip not found' });

    if (req.user!.role !== 'ADMIN' && trip.operatorId !== req.user!.id) {
      return res.status(403).json({ message: 'You can only edit your own trips' });
    }

    const {
      fromCity, toCity, departureTime, arrivalTime,
      availableSeats, isFull, price, totalSeats,
      customStationName, vehicleNumber, contactInfo,
      vehicleType, availableSpace, eta,
    } = req.body;

    const baseUpdate: any = {};
    if (fromCity)      baseUpdate.fromCity      = fromCity;
    if (toCity)        baseUpdate.toCity        = toCity;
    if (departureTime) baseUpdate.departureTime = new Date(departureTime);
    if (arrivalTime)   baseUpdate.arrivalTime   = new Date(arrivalTime);

    if (trip.type === 'LOUAGE') {
      const lu: any = {};
      if (price          !== undefined) lu.price          = Number(price);
      if (totalSeats     !== undefined) lu.totalSeats     = Number(totalSeats);
      if (availableSeats !== undefined) lu.availableSeats = Number(availableSeats);
      if (availableSeats !== undefined) lu.isFull         = Number(availableSeats) === 0;
      if (isFull         !== undefined && availableSeats === undefined) lu.isFull = Boolean(isFull);
      if (customStationName !== undefined) lu.customStationName = customStationName;
      if (vehicleNumber     !== undefined) lu.vehicleNumber     = vehicleNumber;
      if (contactInfo       !== undefined) lu.contactInfo       = contactInfo;
      if (Object.keys(lu).length > 0) baseUpdate.louageTrip = { update: lu };

    } else if (trip.type === 'BUS') {
      const bu: any = {};
      if (price          !== undefined) bu.price          = Number(price);
      if (totalSeats     !== undefined) bu.totalSeats     = Number(totalSeats);
      if (availableSeats !== undefined) bu.availableSeats = Number(availableSeats);
      if (customStationName !== undefined) bu.customDepartureStationName = customStationName;
      if (Object.keys(bu).length > 0) baseUpdate.busTrip = { update: bu };

    } else if (trip.type === 'TRANSPORTER') {
      const tu: any = {};
      if (contactInfo    !== undefined) tu.contactInfo    = contactInfo;
      if (vehicleType    !== undefined) tu.vehicleType    = vehicleType;
      if (availableSpace !== undefined) tu.availableSpace = availableSpace;
      if (eta            !== undefined) tu.eta            = eta;
      if (req.body.route !== undefined) tu.route = req.body.route;
      if (Object.keys(tu).length > 0) baseUpdate.transporterTrip = { update: tu };
    }

    const updated = await prisma.trip.update({ where: { id }, data: baseUpdate, include: INCLUDE_ALL });
    return res.json(formatTrip(updated));
  } catch (error: any) {
    console.error('PUT trip error:', error.message);
    return res.status(500).json({ message: error.message || 'Error updating trip' });
  }
});

// ─── DELETE /api/trips/:id ───────────────────────
router.delete('/:id', authenticate, requireOperator, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const trip = await prisma.trip.findUnique({ where: { id } });
    if (!trip) return res.status(404).json({ message: 'Trip not found' });
    if (req.user!.role !== 'ADMIN' && trip.operatorId !== req.user!.id) {
      return res.status(403).json({ message: 'You can only delete your own trips' });
    }
    await prisma.trip.delete({ where: { id } });
    return res.status(204).send();
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Error deleting trip' });
  }
});
