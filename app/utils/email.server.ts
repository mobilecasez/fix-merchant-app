/**
 * Shared transactional email via Zoho SMTP (same transport the monitor cron + AI report
 * use). Returns false (never throws) if SMTP isn't configured, so callers can proceed.
 */
import nodemailer from "nodemailer";

export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<boolean> {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass || !opts.to) return false;
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.zoho.in",
      port: 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass },
    });
    await transporter.sendMail({
      from: `ShopFlix AI <${smtpUser}>`,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    return true;
  } catch (err) {
    console.error("[email] send failed:", err);
    return false;
  }
}
