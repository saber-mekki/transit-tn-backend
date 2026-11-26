import { Router } from 'express';
import { sendEmail } from '../utils/sendEmail';
import { createEmailCode, checkEmailCode } from '../utils/emailCode';

const router = Router();

router.post('/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });
    const code = await createEmailCode(email);
    await sendEmail(
      email,
      'رمز التحقق - Transit TN',
      `<div style="font-family:sans-serif;max-width:400px;margin:auto;padding:24px;background:#111827;border-radius:12px;">
        <h2 style="color:#6366F1;">🚗 Transit TN</h2>
        <p style="color:#F9FAFB;">رمز التحقق الخاص بك:</p>
        <h1 style="letter-spacing:12px;color:#6366F1;font-size:36px;">${code}</h1>
        <p style="color:#9CA3AF;">صالح لمدة 10 دقائق فقط.</p>
      </div>`
    );
    return res.json({ message: 'Code sent' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Failed to send code' });
  }
});

router.post('/verify-code', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ message: 'Email and code required' });
    // purpose 'reset': the same code must still be sent to /api/auth/reset-password, so keep it
    const ok = await checkEmailCode(email, code, req.body.purpose !== 'reset');
    if (!ok) return res.status(400).json({ message: 'Invalid or expired code' });
    return res.json({ message: 'Verified' });
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
});

export { router };
