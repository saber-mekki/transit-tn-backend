import { Router, Request, Response } from 'express';
import prisma from '../db';

export const router = Router();

router.post('/chat', async (req: Request, res: Response) => {
  const { messages, system, mode } = req.body;
  if (!messages) return res.status(400).json({ message: 'messages required' });

  const apiKey = process.env.GROQ_API_KEY || '';
  if (!apiKey) return res.status(500).json({ message: 'GROQ_API_KEY not set' });

  try {
    // ── Fetch real trips from database ──
    const allTrips = await prisma.trip.findMany({
      include: {
        louageTrip: { include: { station: true } },
        busTrip:    { include: { departureStation: true, arrivalStation: true } },
        transporterTrip: true,
      },
      orderBy: { departureTime: 'asc' },
      take: 100,
    });

    // Format trips as readable text for the AI
    const tripsText = allTrips.map(t => {
      const base = `[${t.type}] ${t.fromCity} → ${t.toCity} | Operator: ${t.operatorName} | Departure: ${new Date(t.departureTime).toLocaleString()}`;
      if (t.louageTrip) {
        return `${base} | Price: ${t.louageTrip.price} TND | Seats: ${t.louageTrip.availableSeats}/${t.louageTrip.totalSeats} | ${t.louageTrip.isFull ? 'FULL' : 'AVAILABLE'} | Station: ${t.louageTrip.station?.name || t.louageTrip.customStationName || 'N/A'}`;
      }
      if (t.busTrip) {
        return `${base} | Price: ${t.busTrip.price} TND | Seats: ${t.busTrip.availableSeats}/${t.busTrip.totalSeats} | Station: ${t.busTrip.departureStation?.name || t.busTrip.customDepartureStationName || 'N/A'}`;
      }
      if (t.transporterTrip) {
        return `${base} | Vehicle: ${t.transporterTrip.vehicleType} | Space: ${t.transporterTrip.availableSpace} | Contact: ${t.transporterTrip.contactInfo}`;
      }
      return base;
    }).join('\n');

    // ── Build system prompt with real data ──
    const enrichedSystem = `${system}

═══════════════════════════════
REAL TRIPS FROM TRANSIT TN DATABASE (${allTrips.length} trips):
═══════════════════════════════
${tripsText || 'No trips available currently.'}
═══════════════════════════════

INSTRUCTIONS:
- When user asks for a trip from X to Y, search the trips list above
- Show matching trips with ALL details (price, seats, time, operator, station)
- If no exact match, suggest closest alternatives
- Format results clearly with emoji
- If trip is FULL, mention it
- Always reply in the SAME language as the user (Arabic/French/English)
- Be helpful and friendly`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: enrichedSystem },
          ...messages.map((m: any) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          })),
        ],
        max_tokens: 1000,
        temperature: 0.3,
      }),
    });

    const data = await response.json() as any;

    if (!response.ok) {
      console.error('Groq error:', data);
      return res.status(500).json({ message: data.error?.message || 'Groq error' });
    }

    const text = data.choices?.[0]?.message?.content || '⚠️ No response.';
    return res.json({ content: [{ type: 'text', text }] });

  } catch (error: any) {
    console.error('AI route error:', error.message);
    return res.status(500).json({ message: error.message });
  }
});
