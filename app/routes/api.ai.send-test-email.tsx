import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import nodemailer from 'nodemailer';

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const { recipientEmail } = await request.json();

  if (!recipientEmail || typeof recipientEmail !== 'string' || !recipientEmail.includes('@')) {
    return json({ error: "Invalid recipient email address provided." }, { status: 400 });
  }

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpUser || !smtpPass) {
    return json({ error: "Email service not configured" }, { status: 500 });
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.zoho.in",
    port: 465,
    secure: true,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  try {
    await transporter.sendMail({
      from: `"Shopify App" <${smtpUser}>`,
      to: recipientEmail,
      subject: 'Shopify App - Test Email',
      html: '<p>This is a test email from your Shopify App.</p><p>If you received this, the email sending functionality is working correctly.</p>',
    });
    return json({ success: true, message: `Test email sent to ${recipientEmail}.` });
  } catch (emailError: any) {
    console.error("Error sending test email:", emailError);
    return json({ error: `Failed to send test email: ${emailError.message}` }, { status: 500 });
  }
}
