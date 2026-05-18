import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export async function sendEmail(to: string, subject: string, html: string) {
  try {
    await transporter.sendMail({
      from: `"Transit TN" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html,
    });
    console.log('✅ Email sent to:', to);
  } catch (e) {
    console.error('❌ Email error:', e);
    throw e;
  }
}
