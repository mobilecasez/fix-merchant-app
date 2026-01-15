import { json, ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { scrapeAmazonNew } from "../utils/scrapers/amazonNew";

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const url = formData.get("url") as string;

  if (!url) {
    return json({ error: "URL is required" }, { status: 400 });
  }

  try {
    console.log('[Test Amazon New] Starting test for:', url);
    
    const extractedData = await scrapeAmazonNew('', url);
    
    return json({ 
      success: true,
      data: extractedData 
    });
    
  } catch (error) {
    console.error('[Test Amazon New] Error:', error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return json({ 
      error: errorMessage,
      success: false 
    }, { status: 500 });
  }
};
