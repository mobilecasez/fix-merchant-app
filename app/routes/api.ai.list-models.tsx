
import { json } from "@remix-run/node";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function loader() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const models = await genAI.getGenerativeModel({ model: "" }).listModels();

  return json({ models });
}
