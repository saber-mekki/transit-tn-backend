"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
exports.router = (0, express_1.Router)();
// ─── GET /api/stations ───────────────────────────
// Public
exports.router.get('/', async (_req, res) => {
    try {
        const stations = await db_1.default.station.findMany({ orderBy: { city: 'asc' } });
        return res.json(stations);
    }
    catch (error) {
        return res.status(500).json({ message: 'Error fetching stations' });
    }
});
// ─── GET /api/stations/:id ───────────────────────
exports.router.get('/:id', async (req, res) => {
    try {
        const station = await db_1.default.station.findUnique({ where: { id: req.params.id } });
        if (!station)
            return res.status(404).json({ message: 'Station not found' });
        return res.json(station);
    }
    catch (error) {
        return res.status(500).json({ message: 'Error fetching station' });
    }
});
// ─── POST /api/stations ──────────────────────────
// Admin only
exports.router.post('/', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const { name, city, lat, lng } = req.body;
    if (!name || !city) {
        return res.status(400).json({ message: 'name and city are required' });
    }
    try {
        const station = await db_1.default.station.create({
            data: { name, city, lat: parseFloat(lat) || 0, lng: parseFloat(lng) || 0 },
        });
        return res.status(201).json(station);
    }
    catch (error) {
        return res.status(500).json({ message: 'Error creating station' });
    }
});
// ─── PUT /api/stations/:id ───────────────────────
exports.router.put('/:id', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, city, lat, lng } = req.body;
    try {
        const updated = await db_1.default.station.update({
            where: { id },
            data: { ...(name && { name }), ...(city && { city }), ...(lat !== undefined && { lat: parseFloat(lat) }), ...(lng !== undefined && { lng: parseFloat(lng) }) },
        });
        return res.json(updated);
    }
    catch (error) {
        return res.status(500).json({ message: 'Error updating station' });
    }
});
// ─── DELETE /api/stations/:id ────────────────────
exports.router.delete('/:id', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    try {
        await db_1.default.station.delete({ where: { id: req.params.id } });
        return res.status(204).send();
    }
    catch (error) {
        return res.status(500).json({ message: 'Error deleting station' });
    }
});
