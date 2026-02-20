import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

/**
 * ADMIN ENDPOINT: Clear all sessions
 * Access: https://shopflixai-production.up.railway.app/admin/clear-sessions?key=ADMIN_KEY
 * 
 * This endpoint clears all sessions from the database.
 * Use this when changing app configuration (client ID, scopes, etc.)
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  
  // Simple security check (you should use a proper admin key in production)
  const ADMIN_KEY = process.env.ADMIN_KEY || "clearSessions2024";
  
  if (key !== ADMIN_KEY) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  
  try {
    // Clear all sessions
    const result = await prisma.session.deleteMany({});
    
    return json({
      success: true,
      message: `Cleared ${result.count} session(s)`,
      timestamp: new Date().toISOString(),
      nextSteps: [
        "Uninstall the app from your test store",
        "Reinstall the app",
        "Test the auth flow"
      ]
    });
    
  } catch (error) {
    return json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
};
