"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const cloudinary_1 = require("cloudinary");
const multer_1 = __importDefault(require("multer"));
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
exports.router = router;
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
cloudinary_1.v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});
// GET /api/banners - public, get active banners
router.get('/', async (req, res) => {
    try {
        const banners = await db_1.default.banner.findMany({
            where: { active: true },
            orderBy: { order: 'asc' }
        });
        res.json(banners);
    }
    catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
});
// POST /api/banners - admin only, upload image
router.post('/', auth_1.authenticate, upload.single('image'), async (req, res) => {
    if (req.user?.role !== 'ADMIN')
        return res.status(403).json({ message: 'Forbidden' });
    try {
        const { title, subtitle, link, order } = req.body;
        let imageUrl = req.body.imageUrl;
        // Upload to Cloudinary if file provided
        if (req.file) {
            const result = await new Promise((resolve, reject) => {
                cloudinary_1.v2.uploader.upload_stream({ folder: 'transit-tn/banners', transformation: [{ width: 800, height: 400, crop: 'fill' }] }, (error, result) => error ? reject(error) : resolve(result)).end(req.file.buffer);
            });
            imageUrl = result.secure_url;
        }
        if (!imageUrl)
            return res.status(400).json({ message: 'Image required' });
        const banner = await db_1.default.banner.create({
            data: { imageUrl, title: title || null, subtitle: subtitle || null, link: link || null, order: parseInt(order) || 0 }
        });
        res.status(201).json(banner);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
});
// DELETE /api/banners/:id - admin only
router.delete('/:id', auth_1.authenticate, async (req, res) => {
    if (req.user?.role !== 'ADMIN')
        return res.status(403).json({ message: 'Forbidden' });
    try {
        await db_1.default.banner.delete({ where: { id: req.params.id } });
        res.json({ message: 'Deleted' });
    }
    catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
});
// PATCH /api/banners/:id - toggle active
router.patch('/:id', auth_1.authenticate, async (req, res) => {
    if (req.user?.role !== 'ADMIN')
        return res.status(403).json({ message: 'Forbidden' });
    try {
        const banner = await db_1.default.banner.update({
            where: { id: req.params.id },
            data: { active: req.body.active, order: req.body.order }
        });
        res.json(banner);
    }
    catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
});
