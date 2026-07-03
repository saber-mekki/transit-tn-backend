"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
const resend_1 = require("resend");
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
async function sendEmail(to, subject, html) {
    try {
        const { data, error } = await resend.emails.send({
            from: 'Transit TN <noreply@transit-tn.tn>',
            to,
            subject,
            html,
        });
        if (error)
            throw error;
        console.log('✅ Email sent to:', to);
    }
    catch (e) {
        console.error('❌ Email error:', e);
        throw e;
    }
}
