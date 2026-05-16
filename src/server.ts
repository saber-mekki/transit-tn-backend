import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import { router as authRoutes }          from './routes/auth';
import { router as userRoutes }          from './routes/users';
import { router as tripRoutes }          from './routes/trips';
import { router as stationRoutes }       from './routes/stations';
import { router as locationRoutes }      from './routes/locations';
import { router as notificationRoutes }  from './routes/notifications';
import { router as aiRoutes }             from './routes/ai';
import verifyRoutes                        from './routes/verify';
import { router as bannerRoutes }           from './routes/banners';
import { router as operatorRatingRoutes }   from './routes/operatorRatings';
import { router as reservationRoutes }      from './routes/reservations';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ─── SECURITY MIDDLEWARE ─────────────────────────
app.use(helmet());

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:8081',
    'http://localhost:19006',
    'http://localhost:19000',
    process.env.FRONTEND_URL || '',
  ],
  credentials: true,
}));

// Rate limiting — 100 requests per 15 min per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
});
app.use(limiter);

// Stricter rate limit on auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Too many auth attempts, please try again later.' },
});

// ─── BODY PARSING ────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── HEALTH CHECK ────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0' });
});

// ─── API ROUTES ──────────────────────────────────
app.use('/api/auth',          authLimiter, authRoutes);
app.use('/api/ai',            aiRoutes);
app.use('/api/verify',         verifyRoutes);
app.use('/api/banners',        bannerRoutes);
app.use('/api/operators',      operatorRatingRoutes);
app.use('/api/reservations',   reservationRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/trips',         tripRoutes);
app.use('/api/stations',      stationRoutes);
app.use('/api/locations',     locationRoutes);
app.use('/api/notifications', notificationRoutes);

// ─── 404 HANDLER ─────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// ─── GLOBAL ERROR HANDLER ────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

// ─── START ───────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Transit TN Backend running on http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

export default app;
