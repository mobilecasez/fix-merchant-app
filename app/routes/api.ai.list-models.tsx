
import { json } from "@remix-run/node";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function loader() {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY || "";
  
  if (!apiKey) {
    return json({ error: "API key not configured" }, { status: 500 });
  }
  
  // Return list of commonly used Gemini models
  const models = [
    {
      name: "gemini-2.0-flash",
      displayName: "Gemini 2.0 Flash",
      description: "Fast, efficient model for most tasks"
    },
    {
      name: "gemini-1.5-flash",
      displayName: "Gemini 1.5 Flash", 
      description: "Fast model for common tasks"
    },
    {
      name: "gemini-1.5-pro",
      displayName: "Gemini 1.5 Pro",
      description: "Advanced model for complex tasks"
    }
  ];

  return json({ models });
}
