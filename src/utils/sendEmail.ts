import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(to: string, subject: string, html: string) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'Transit TN <onboarding@resend.dev>',
      to,
      subject,
      html,
    });
    if (error) throw error;
    console.log('✅ Email sent to:', to);
  } catch (e) {
    console.error('❌ Email error:', e);
    throw e;
  }
}
