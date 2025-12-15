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

  const transporter = nodemailer.createTransport({
    host: "smtp.zoho.in",
    port: 465,
    secure: true, // Use SSL
    auth: {
      user: "Shopify-app@mobilecasez.com",
      pass: "Ab!12345", // This should ideally be from environment variables
    },
  });

  try {
    await transporter.sendMail({
      from: '"Shopify App" <Shopify-app@mobilecasez.com>',
      to: recipientEmail,
      subject: 'Shopify App - Test Email',
      html: '<p>This is a test email from your Shopify App.</p><p>If you received this, the email sending functionality is working correctly.</p>',
    });
    console.log(`Test email sent to ${recipientEmail}.`);
    return json({ success: true, message: `Test email sent to ${recipientEmail}.` });
  } catch (emailError: any) {
    console.error("Error sending test email:", emailError);
    return json({ error: `Failed to send test email: ${emailError.message}` }, { status: 500 });
  }
}
