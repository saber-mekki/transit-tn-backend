import { Router, Request, Response } from 'express';

export const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const { name, email, phone, type, message } = req.body;
  if (!name || !message) return res.status(400).json({ message: 'Name and message required' });

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Transit TN <onboarding@resend.dev>',
        to: ['saber.mekki6@gmail.com'],
        subject: `📬 ${type || 'Contact'} - Transit TN`,
        html: `
          <h2>Nouveau message - Transit TN</h2>
          <p><b>Type:</b> ${type || 'Contact'}</p>
          <p><b>Nom:</b> ${name}</p>
          <p><b>Email:</b> ${email || 'Non fourni'}</p>
          <p><b>Téléphone:</b> ${phone || 'Non fourni'}</p>
          <hr/>
          <p><b>Message:</b></p>
          <p>${message}</p>
        `
      })
    });
    return res.json({ message: 'Sent' });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to send' });
  }
});
