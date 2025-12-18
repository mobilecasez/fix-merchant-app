import { json, ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { JSDOM } from "jsdom";
import { getScraper } from "../utils/scrapers.server";
import fs from "fs";
import path from "path";

async function extractProductDataWithAI(url: string, htmlContent: string) {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const categoriesPath = path.resolve(process.cwd(), "categories.txt");
  const categoriesContent = fs.readFileSync(categoriesPath, "utf-8");
  const categoriesList = categoriesContent.split("\n").filter(line => line.trim() !== "" && !line.startsWith("#")).map(line => line.split(" : ")[1].trim());

  const dom = new JSDOM(htmlContent);
  const images = Array.from(dom.window.document.querySelectorAll('img')).flatMap(img => {
    const sources = [img.src];
    if (img.srcset) {
      const srcsetSources = img.srcset.split(',').map(s => s.trim().split(' ')[0]);
      sources.push(...srcsetSources);
    }
    return sources;
  });

  const prompt = `
    From the HTML content of "${url}", extract the product information into a JSON object.

    HTML:
    \`\`\`html
    ${htmlContent}
    \`\`\`

    Image URLs:
    ${images.join('\n')}

    Here is the full list of valid Google Product Categories:
    \`\`\`
    ${categoriesList.join('\n')}
    \`\`\`

    JSON output should follow this structure. Do not include any text or markdown formatting before or after the JSON object.

    {
      "productName": "string",
      "description": "string (HTML format)",
      "vendor": "string",
      "productType": "string",
      "tags": "string (comma-separated)",
      "price": "string",
      "compareAtPrice": "string",
      "costPerItem": "string",
      "sku": "string",
      "barcode": "string",
      "weight": "string",
      "weightUnit": "string (kg, g, lb, or oz)",
      "images": ["url1", "url2", ...],
      "options": [
        { "name": "string", "values": "string (comma-separated)" }
      ],
      "variants": [
        {
          "title": "string",
          "price": "string",
          "sku": "string",
          "barcode": "string",
          "quantity": "string"
        }
      ]
    }

    Instructions:
    - Return an empty string "" or an empty array [] if a field is not found.
    - Description should be in HTML format.
    - Extract all high-resolution product image URLs.
    - Identify all product options (e.g., "Size", "Color") and their values.
    - List all variant combinations with their price, SKU, and barcode.
    - If a value is absolutely not present, return null for that field.
    - Do not return an empty object. Make your best effort to fill the fields.
  `;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
  };

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("AI API Error:", errorBody);
      throw new Error(`AI API request failed with status ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    const text = data.candidates[0].content.parts[0].text;

    console.log("Raw AI Response:", text);

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch && jsonMatch[0]) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.error("Failed to parse JSON from AI response:", e);
        throw new Error("Invalid JSON format in AI response.");
      }
    }

    throw new Error("No valid JSON object found in AI response.");
  } catch (error) {
    console.error("AI extraction failed:", error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    throw new Error(errorMessage);
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const url = formData.get("url") as string;

  if (!url) {
    return json({ error: "URL is required" }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36",
      },
    });
    if (!response.ok) {
      return json({ error: `Failed to fetch URL: ${response.statusText}` }, { status: response.status });
    }
    const html = await response.text();
    
    const scraper = getScraper(url);

    let productData;
    if (scraper) {
      console.log("Using local scraper.");
      try {
        productData = await scraper(html, url);
        
        // Validate that scraper returned valid data
        if (!productData.productName || productData.productName.trim() === "") {
          console.log("Scraper returned empty product name, falling back to AI scraper");
          // Fall back to AI extraction
          const dom = new JSDOM(html);
          const body = dom.window.document.body.innerHTML;
          productData = await extractProductDataWithAI(url, body);
        }
      } catch (scraperError) {
        console.error("Local scraper failed, falling back to AI:", scraperError);
        // Fall back to AI extraction on scraper error
        const dom = new JSDOM(html);
        const body = dom.window.document.body.innerHTML;
        productData = await extractProductDataWithAI(url, body);
      }
    } else {
      console.log("Using AI scraper.");
      const dom = new JSDOM(html);
      const body = dom.window.document.body.innerHTML;
      productData = await extractProductDataWithAI(url, body);
    }

    // Final validation
    if (!productData || !productData.productName || productData.productName.trim() === "") {
      return json({ 
        error: "Unable to fetch product data. The website may be blocking automated access. Please add product manually." 
      }, { status: 400 });
    }

    return json(productData);
  } catch (error) {
    console.error("Error fetching product data:", error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return json({ error: errorMessage }, { status: 500 });
  }
};
