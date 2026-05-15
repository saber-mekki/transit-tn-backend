import { Router, Request, Response } from 'express';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import prisma from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// GET /api/banners - public, get active banners
router.get('/', async (req: Request, res: Response) => {
  try {
    const banners = await prisma.banner.findMany({
      where: { active: true },
      orderBy: { order: 'asc' }
    });
    res.json(banners);
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/banners - admin only, upload image
router.post('/', authenticate, upload.single('image'), async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ message: 'Forbidden' });

  try {
    const { title, subtitle, link, order } = req.body;
    let imageUrl = req.body.imageUrl;

    // Upload to Cloudinary if file provided
    if (req.file) {
      const result = await new Promise<any>((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: 'transit-tn/banners', transformation: [{ width: 800, height: 400, crop: 'fill' }] },
          (error, result) => error ? reject(error) : resolve(result)
        ).end(req.file!.buffer);
      });
      imageUrl = result.secure_url;
    }

    if (!imageUrl) return res.status(400).json({ message: 'Image required' });

    const banner = await prisma.banner.create({
      data: { imageUrl, title: title || null, subtitle: subtitle || null, link: link || null, order: parseInt(order) || 0 }
    });
    res.status(201).json(banner);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/banners/:id - admin only
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ message: 'Forbidden' });
  try {
    await prisma.banner.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/banners/:id - toggle active
router.patch('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ message: 'Forbidden' });
  try {
    const banner = await prisma.banner.update({
      where: { id: req.params.id },
      data: { active: req.body.active, order: req.body.order }
    });
    res.json(banner);
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

export { router };
