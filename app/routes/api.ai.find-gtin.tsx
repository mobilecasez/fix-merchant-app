import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { retryOperation } from "../utils/retry.js";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const productString = url.searchParams.get("product");

  if (!productString) {
    return json({ error: "Product data is missing" }, { status: 400 });
  }

  const product = JSON.parse(decodeURIComponent(productString));

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });

  const prompt = `
  You are an expert in product data and Google Merchant Center. Your task is to identify the Global Trade Item Number (GTIN) for the following product. The GTIN could be a UPC, EAN, ISBN, or JAN.

  Just send the title of the product like this:
  ${product.title}

  Output should be
  {
    "gtin": "195949909030"
  }
  `;

  console.log("GTIN Search - Request Product Data:", JSON.stringify(product, null, 2));
  console.log("GTIN Search - AI Prompt:", prompt);

  const maxRetries = 3;
  const initialRetryDelayMs = 1000;

  try {
    const aiResponseText = await retryOperation(async () => {
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('AI response timed out')), 60000) // 60 seconds timeout
        ),
      ]);
      const response = await (result as any).response;
      return response.text();
    }, maxRetries, initialRetryDelayMs, product.id);

    const startIndex = aiResponseText.indexOf('{');
    const endIndex = aiResponseText.lastIndexOf('}');
    const jsonString = aiResponseText.substring(startIndex, endIndex + 1);
    
    const aiResponse = JSON.parse(jsonString);
    console.log("GTIN Search - AI Response:", JSON.stringify(aiResponse, null, 2));
    return json({ ...aiResponse, promptUsed: prompt }); // Include the prompt in the response
  } catch (error: any) {
    console.error(`Final attempt failed for GTIN search for product ${product.id}:`, error);
    return json({ gtin: null, error: `Failed to get GTIN from AI: ${error.message}`, promptUsed: prompt }, { status: 500 });
  }
}
