
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY || "";
  
  if (!apiKey) {
    return json({ error: "API key not configured" }, { status: 500 });
  }
  
  // Return list of commonly used Gemini models
  const models = [
    {
      name: "gemini-2.5-flash",
      displayName: "Gemini 2.5 Flash",
      description: "Fast, efficient model for most tasks"
    },
    {
      name: "gemini-2.5-flash-lite",
      displayName: "Gemini 2.5 Flash Lite", 
      description: "Fastest and most cost-efficient multimodal model"
    },
    {
      name: "gemini-2.5-pro",
      displayName: "Gemini 2.5 Pro",
      description: "Advanced model for complex tasks"
    }
  ];

  return json({ models });
}
