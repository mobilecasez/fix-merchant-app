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

  // Validate URL format and block internal/private addresses (SSRF protection)
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(storeUrl);
  } catch {
    return json({ error: "Invalid URL format" }, { status: 400 });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return json({ error: "Only HTTP/HTTPS URLs are allowed" }, { status: 400 });
  }

  const blockedHostnames = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];
  const blockedPrefixes = ['10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.', '192.168.', '169.254.'];
  if (
    blockedHostnames.includes(parsedUrl.hostname) ||
    blockedPrefixes.some(prefix => parsedUrl.hostname.startsWith(prefix))
  ) {
    return json({ error: "Internal or private URLs are not allowed" }, { status: 400 });
  }

  let rawHtmlContent: string = "";
  try {
    const response = await fetch(storeUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    
    if (!response.ok) {
      return json({ error: `Failed to fetch store: HTTP ${response.status}` }, { status: 502 });
    }
    
    rawHtmlContent = await response.text();

  } catch (error: unknown) {
    console.error(`Failed to fetch raw HTML content for ${storeUrl}:`, error);
    return json({ error: `Failed to fetch store content: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }

  return json({ rawHtmlContent });
}
