import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Resend } = require('resend');

const router = Router();
const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

router.post('/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.emailVerification.create({ data: { email, code, expiresAt } });

    await resend.emails.send({
      from: 'TransitTN <onboarding@resend.dev>',
      to: email,
      subject: 'رمز التحقق - Transit TN',
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:auto;padding:24px;background:#111827;border-radius:12px;">
          <h2 style="color:#6366F1;">🚗 Transit TN</h2>
          <p style="color:#F9FAFB;">رمز التحقق الخاص بك:</p>
          <h1 style="letter-spacing:12px;color:#6366F1;font-size:36px;">${code}</h1>
          <p style="color:#9CA3AF;">صالح لمدة 10 دقائق فقط.</p>
        </div>
      `
    });

    res.json({ message: 'Code sent' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to send code' });
  }
});

router.post('/verify-code', async (req, res) => {
  try {
    const { email, code } = req.body;
    const record = await prisma.emailVerification.findFirst({
      where: { email, code, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' }
    });

    if (!record) return res.status(400).json({ message: 'Invalid or expired code' });

    await prisma.emailVerification.deleteMany({ where: { email } });
    res.json({ verified: true });
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
