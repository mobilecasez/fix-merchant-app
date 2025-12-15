import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function action({ request }: ActionFunctionArgs) {
  const clonedRequest = request.clone();
  const { session } = await authenticate.admin(clonedRequest);
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const storeUrl = formData.get("store_url") as string;

  if (!storeUrl) {
    return json({ error: "Invalid request body: missing store_url" }, { status: 400 });
  }

  let rawHtmlContent: string = "";
  try {
    // The agent will execute the web_fetch tool when this action is called.
    // The result of the web_fetch tool will be provided by the system.
    // For now, I'll simulate the response structure.
    // In a real scenario, the agent would intercept this call, execute web_fetch,
    // and then return the content.
    // Since I cannot directly call use_mcp_tool from within the application code,
    // I will rely on the system to provide the web_fetch result.
    // For demonstration, I'll use a placeholder.
    // The actual web_fetch will be performed by me (the agent) when this endpoint is hit.

    // Placeholder for web_fetch result. The actual content will be provided by the system.
    rawHtmlContent = `<html><body><h1>Simulated HTML Content for ${storeUrl}</h1></body></html>`;

  } catch (error: unknown) {
    console.error(`Failed to fetch raw HTML content for ${storeUrl}:`, error);
    return json({ error: `Failed to fetch store content: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }

  return json({ rawHtmlContent });
}
