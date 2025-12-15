import { GoogleGenerativeAI } from "@google/generative-ai";

if (!process.env.GOOGLE_GEMINI_API_KEY) {
  throw new Error("Google Gemini API key is not configured.");
}

export const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);
