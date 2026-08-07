import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './env';
import { logger } from './logger';

/** True when real SMTP credentials are configured (so OTP emails can actually be sent). */
export const emailConfigured = config.email.configured;

let transporter: Transporter | null = null;

if (emailConfigured) {
  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: { user: config.email.user, pass: config.email.pass },
  });
  transporter
    .verify()
    .then(() => logger.info('✓ SMTP ready — password-reset emails enabled'))
    .catch((e) => logger.warn(`SMTP verify failed (emails may not send): ${e instanceof Error ? e.message : String(e)}`));
} else {
  logger.warn('SMTP not configured — password-reset OTPs are surfaced in dev only, not emailed. Set SMTP_* in .env to enable email.');
}

function otpEmailHtml(name: string | null, otp: string, minutes: number): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#141414;">
    <div style="background:#FAE300;border-radius:12px 12px 0 0;padding:18px 24px;">
      <span style="display:inline-block;background:#141414;color:#ffffff;font-weight:900;font-size:20px;letter-spacing:1px;padding:6px 12px;border-radius:8px;">MT&amp;T</span>
    </div>
    <div style="border:1px solid #eeeeee;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
      <h2 style="margin:0 0 8px;font-size:18px;">Password reset code</h2>
      <p style="margin:0 0 16px;color:#475569;">Hi ${name || 'there'}, use this code to reset your MTANDT Platform password:</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:10px;text-align:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin:0 0 16px;">${otp}</div>
      <p style="margin:0;color:#64748b;font-size:13px;">This code expires in ${minutes} minutes. If you didn't request a reset, you can safely ignore this email.</p>
    </div>
  </div>`;
}

/** Send the OTP email. Throws if SMTP isn't configured — callers handle the dev fallback. */
export async function sendOtpEmail(to: string, name: string | null, otp: string): Promise<void> {
  if (!transporter) throw new Error('SMTP is not configured');
  const minutes = config.passwordReset.otpExpiryMinutes;
  await transporter.sendMail({
    from: config.email.from,
    to,
    subject: 'Your MTANDT password reset code',
    html: otpEmailHtml(name, otp, minutes),
    text: `Your MTANDT Platform password reset code is ${otp}. It expires in ${minutes} minutes. If you didn't request this, ignore this email.`,
  });
}
