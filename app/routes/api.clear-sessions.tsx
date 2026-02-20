import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

/**
 * API ENDPOINT: Clear all sessions
 * GET/POST https://shopflixai-production.up.railway.app/api/clear-sessions?key=ADMIN_KEY
 * 
 * This endpoint clears all sessions from the database.
 * Use this when changing app configuration (client ID, scopes, etc.)
 */

async function clearAllSessions(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  
  // Simple security check
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
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return clearAllSessions(request);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return clearAllSessions(request);
};
