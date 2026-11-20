"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
// ─── AI CHAT (Recherche IA / Guide touristique) — Groq ─────────────────
// POST /api/ai/chat { messages: [{role, content}], mode?: 'trip' | 'tour', lang? }
//   → { content: [{ type: 'text', text }] }
//
// Model: GROQ_MODEL if set, else the first available model from PREFERRED_MODELS
// (checked against the account's /models list). If Groq says a model doesn't
// exist / is decommissioned / not allowed, the next one is tried automatically —
// a retired model no longer breaks the chatbot.
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
exports.router = (0, express_1.Router)();
const GROQ_BASE = (process.env.GROQ_API_BASE || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
const PREFERRED_MODELS = [
    'llama-3.3-70b-versatile',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'qwen/qwen3-32b',
    'llama-3.1-8b-instant',
];
const NOT_CHAT = /whisper|tts|guard|playai|orpheus|distil|embed|compound/i;
const MAX_MODEL_TRIES = 4;
const GROQ_TIMEOUT_MS = 25000;
const MAX_HISTORY = 12;
const MAX_MSG_CHARS = 2000;
// ── Model choice (cached) ──
let workingModel = null;
const badModels = new Set();
let modelList = null;
async function availableModels(apiKey) {
    if (modelList && Date.now() - modelList.at < 60 * 60 * 1000)
        return modelList.ids;
    try {
        const r = await fetch(`${GROQ_BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000) });
        if (!r.ok)
            return null;
        const d = await r.json();
        const ids = (d?.data || []).filter((m) => m?.id && m.active !== false).map((m) => String(m.id));
        modelList = { ids, at: Date.now() };
        return ids;
    }
    catch {
        return null;
    }
}
async function candidateModels(apiKey) {
    const forced = (process.env.GROQ_MODEL || '').trim();
    const out = [];
    const add = (m) => { if (m && !badModels.has(m) && !out.includes(m))
        out.push(m); };
    if (forced)
        add(forced);
    if (workingModel)
        add(workingModel);
    const ids = await availableModels(apiKey);
    if (ids) {
        PREFERRED_MODELS.filter(m => ids.includes(m)).forEach(add);
        ids.filter(m => !NOT_CHAT.test(m)).sort().forEach(add); // anything else that can chat
    }
    else {
        PREFERRED_MODELS.forEach(add); // /models unreachable: try the usual ones
    }
    return out.slice(0, MAX_MODEL_TRIES);
}
const isModelError = (status, err) => {
    const msg = String(err?.message || '');
    return status === 404 || err?.code === 'model_not_found' || err?.code === 'model_decommissioned'
        || /does not exist|decommissioned|not have access|model.*not.*(found|supported|available)/i.test(msg);
};
// ── Trips given to the model ──
const TYPE_WORDS = {
    LOUAGE: /louage|لواج|taxi collectif/i,
    BUS: /\bbus\b|حافلة|كار|autocar|sntri/i,
    TRANSPORTER: /transport(eur|er)|colis|fret|freight|شحن|طرد|نقل البضائع/i,
};
const norm = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Trips that are still bookable (not completed), the ones matching the question first. */
async function tripsFor(question) {
    const trips = await db_1.default.trip.findMany({
        where: { status: { not: 'COMPLETED' } },
        include: {
            louageTrip: { include: { station: true } },
            busTrip: { include: { departureStation: true, arrivalStation: true } },
            transporterTrip: true,
        },
        orderBy: { departureTime: 'asc' },
        take: 400,
    });
    const q = norm(question);
    const wantedTypes = Object.keys(TYPE_WORDS).filter(k => TYPE_WORDS[k].test(question));
    const cityHit = (c) => norm(c).split(/[,\s-]+/).some(w => w.length >= 3 && q.includes(w));
    const score = (t) => (cityHit(t.fromCity) ? 3 : 0) + (cityHit(t.toCity) ? 3 : 0) + (wantedTypes.includes(String(t.type)) ? 2 : 0);
    return trips
        .map(t => ({ t, s: score(t) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 40)
        .map(x => x.t);
}
function tripLine(t) {
    const d = new Date(t.departureTime);
    const when = d.getFullYear() >= 2099
        ? 'on demand'
        : d.toLocaleString('fr-FR', { timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const base = `[${t.type}] ${t.fromCity} → ${t.toCity} | ${t.operatorName} | ${when}`;
    if (t.louageTrip) {
        const l = t.louageTrip;
        return `${base} | ${l.price} TND | seats ${l.availableSeats}/${l.totalSeats} | ${l.isFull ? 'FULL' : 'available'} | station: ${l.station?.name || l.customStationName || 'n/a'}${l.contactInfo ? ` | tel: ${l.contactInfo}` : ''}`;
    }
    if (t.busTrip) {
        const b = t.busTrip;
        return `${base} | ${b.price ? `${b.price} TND` : 'price n/a'} | seats ${b.availableSeats}/${b.totalSeats} | station: ${b.departureStation?.name || b.customDepartureStationName || 'n/a'}`;
    }
    if (t.transporterTrip) {
        const r = t.transporterTrip;
        return `${base} | vehicle: ${r.vehicleType || 'n/a'} | space: ${r.availableSpace || 'n/a'}${r.contactInfo ? ` | contact: ${r.contactInfo}` : ''}`;
    }
    return base;
}
const SYSTEM = {
    trip: `You are the trip-search assistant of Transit TN (Tunisia). Transport types: louage (shared taxi), bus, transporteur (parcels / freight, also international).
Answer ONLY from the trips listed below. Never invent trips, prices, times or phone numbers.
- For "X → Y" questions list the matching trips: type, route, date/time, price, seats/availability, operator, station.
- If nothing matches exactly, say so and suggest the closest trips (same departure or destination city, or another transport type).
- Trips marked FULL: say they are full.
- Use short lines with emoji. Be brief and friendly.
- Always reply in the SAME language as the user (Arabic, French or English).`,
    tour: `You are an expert tour guide for Tunisia: cities, Carthage, Bardo Museum, El Djem, Dougga, medinas, food (brik, couscous, harissa, lablabi, makroudh), Sahara tours, Matmata.
Reply in the SAME language as the user. Use emoji headers. Max 250 words.`,
};
exports.router.post('/chat', async (req, res) => {
    const { messages, system } = req.body || {};
    if (!Array.isArray(messages) || !messages.length)
        return res.status(400).json({ message: 'messages required' });
    // Older apps send only a `system` text: detect the tour-guide mode from it.
    const mode = req.body?.mode === 'tour' || (!req.body?.mode && /tour guide/i.test(String(system || ''))) ? 'tour' : 'trip';
    const apiKey = process.env.GROQ_API_KEY || '';
    if (!apiKey) {
        console.error('[ai] GROQ_API_KEY is not set');
        return res.status(503).json({ message: 'AI service not configured', code: 'ai_unavailable' });
    }
    const history = messages.slice(-MAX_HISTORY).map((m) => ({
        role: m?.role === 'assistant' ? 'assistant' : 'user',
        content: String(m?.content ?? '').slice(0, MAX_MSG_CHARS),
    })).filter((m) => m.content.trim());
    if (!history.length)
        return res.status(400).json({ message: 'messages required' });
    const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content || '';
    try {
        let sys = SYSTEM[mode];
        if (mode === 'trip') {
            const trips = await tripsFor(lastUser);
            sys += `\n\nTRIPS AVAILABLE NOW (${trips.length}, most relevant first):\n${trips.map(tripLine).join('\n') || 'No trips available right now.'}`;
        }
        let lastError = 'AI error';
        for (const model of await candidateModels(apiKey)) {
            const r = await fetch(`${GROQ_BASE}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'system', content: sys }, ...history],
                    max_tokens: 1000,
                    temperature: 0.3,
                }),
                signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
            });
            const data = await r.json().catch(() => ({}));
            if (r.ok) {
                if (workingModel !== model)
                    console.log(`[ai] using Groq model ${model}`);
                workingModel = model;
                const text = String(data?.choices?.[0]?.message?.content || '')
                    .replace(/<think>[\s\S]*?<\/think>/g, '') // reasoning models
                    .trim() || '⚠️';
                return res.json({ content: [{ type: 'text', text }], model });
            }
            lastError = data?.error?.message || `Groq HTTP ${r.status}`;
            if (isModelError(r.status, data?.error)) {
                console.warn(`[ai] model ${model} unavailable: ${lastError}`);
                badModels.add(model);
                if (workingModel === model)
                    workingModel = null;
                continue; // try the next model
            }
            console.error('[ai] Groq error:', r.status, lastError);
            if (r.status === 401)
                return res.status(503).json({ message: 'AI service key invalid', code: 'ai_unavailable' });
            if (r.status === 429)
                return res.status(503).json({ message: 'AI service busy, retry in a moment', code: 'ai_busy' });
            return res.status(502).json({ message: lastError, code: 'ai_error' });
        }
        console.error('[ai] no usable Groq model:', lastError);
        return res.status(503).json({ message: 'No AI model available', code: 'ai_unavailable' });
    }
    catch (error) {
        const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        console.error('[ai] route error:', error?.message);
        return res.status(timeout ? 504 : 500).json({ message: timeout ? 'AI timeout' : 'AI route error', code: timeout ? 'ai_timeout' : 'ai_error' });
    }
});
