import { json, type ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

// Contact form API endpoint
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { name, email, phone, subject, message } = body;

    // Validate required fields
    if (!name || !email || !subject || !message) {
      return json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    // Get IP address
    const ipAddress =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "unknown";

    // Get user agent
    const userAgent = request.headers.get("user-agent") || "unknown";

    // Save to database
    const contactMessage = await prisma.contactMessage.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone?.trim() || null,
        subject: subject.trim(),
        message: message.trim(),
        ipAddress,
        userAgent,
        status: "new",
      },
    });

    console.log("Contact form submission received:", {
      id: contactMessage.id,
      email: contactMessage.email,
      subject: contactMessage.subject,
      ipAddress,
    });

    return json(
      {
        success: true,
        message: "Your message has been received successfully",
        id: contactMessage.id,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error processing contact form:", error);
    return json(
      {
        error: "Failed to process your message. Please try again later.",
      },
      { status: 500 }
    );
  }
}
