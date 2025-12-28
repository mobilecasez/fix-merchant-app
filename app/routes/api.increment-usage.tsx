import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { incrementProductUsage } from "../utils/billing.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);

  try {
    await incrementProductUsage(session.shop);
    return json({ success: true });
  } catch (error) {
    console.error("Error incrementing product usage:", error);
    return json(
      { error: error instanceof Error ? error.message : "Failed to increment usage" },
      { status: 500 }
    );
  }
}
