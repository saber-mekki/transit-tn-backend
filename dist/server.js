"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const dotenv_1 = __importDefault(require("dotenv"));
const auth_1 = require("./routes/auth");
const users_1 = require("./routes/users");
const trips_1 = require("./routes/trips");
const stations_1 = require("./routes/stations");
const locations_1 = require("./routes/locations");
const notifications_1 = require("./routes/notifications");
const ai_1 = require("./routes/ai");
const verify_1 = require("./routes/verify");
const banners_1 = require("./routes/banners");
const operatorRatings_1 = require("./routes/operatorRatings");
const reservations_1 = require("./routes/reservations");
const stats_1 = require("./routes/stats");
const contact_1 = require("./routes/contact");
const shipments_1 = require("./routes/shipments");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// ─── SECURITY MIDDLEWARE ─────────────────────────
app.use((0, helmet_1.default)());
app.set('trust proxy', 1);
app.use((0, cors_1.default)());
// Rate limiting — 100 requests per 15 min per IP
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests, please try again later.' },
});
app.use(limiter);
// Stricter rate limit on auth routes
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { message: 'Too many auth attempts, please try again later.' },
});
// ─── BODY PARSING ────────────────────────────────
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
// ─── HEALTH CHECK ────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0' });
});
// ─── API ROUTES ──────────────────────────────────
app.use('/api/auth', authLimiter, auth_1.router);
app.use('/api/ai', ai_1.router);
app.use('/api/verify', verify_1.router);
app.use('/api/banners', banners_1.router);
app.use('/api/operators', operatorRatings_1.router);
app.use('/api/reservations', reservations_1.router);
app.use('/api/stats', stats_1.router);
app.use('/api/contact', contact_1.router);
app.use('/api/users', users_1.router);
app.use('/api/shipments', shipments_1.router);
app.use('/api/trips', trips_1.router);
app.use('/api/stations', stations_1.router);
app.use('/api/locations', locations_1.router);
app.use('/api/notifications', notifications_1.router);
// ─── 404 HANDLER ─────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ message: 'Route not found' });
});
// ─── GLOBAL ERROR HANDLER ────────────────────────
app.use((err, _req, res, _next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ message: 'Internal server error' });
});
// ─── START ───────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🚀 Transit TN Backend running on http://localhost:${PORT}`);
    console.log(`📋 Health check: http://localhost:${PORT}/health`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});
exports.default = app;
// redeploy
