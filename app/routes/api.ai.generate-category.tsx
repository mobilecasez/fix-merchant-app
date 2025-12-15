import { json, ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import fs from "fs";
import path from "path";
import Fuse from "fuse.js";

interface CategoryListItem {
  id: string;
  path: string;
}

function parseCategoryList(fileContent: string): CategoryListItem[] {
  const lines = fileContent.split("\n").filter(line => line.trim() !== "" && !line.startsWith("#"));
  const categories: CategoryListItem[] = [];

  lines.forEach(line => {
    const [gidPart, pathPart] = line.split(" : ");
    if (gidPart && pathPart) {
      categories.push({
        id: gidPart.trim(),
        path: pathPart.trim(),
      });
    }
  });

  return categories;
}

async function generateCategoryWithAI(title: string) {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const categoriesPath = path.resolve(process.cwd(), "categories.txt");
  const categoriesContent = fs.readFileSync(categoriesPath, "utf-8");
  const categoriesList = categoriesContent.split("\n").filter(line => line.trim() !== "" && !line.startsWith("#")).map(line => line.split(" : ")[1].trim());

  const prompt = `
    Based on the product title "${title}", select the most appropriate Google Product Category from the following list.

    Categories:
    \`\`\`
    ${categoriesList.join('\n')}
    \`\`\`

    Return only the full category path as a string (e.g., "Apparel & Accessories > Clothing > Activewear"). Do not include any other text or formatting.
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

    console.log("Raw AI Category Response:", text);
    return text.trim();
  } catch (error) {
    console.error("AI category generation failed:", error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    throw new Error(errorMessage);
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const title = formData.get("title") as string;

  if (!title) {
    return json({ error: "Title is required" }, { status: 400 });
  }

  try {
    const generatedCategory = await generateCategoryWithAI(title);

    const filePath = path.resolve(process.cwd(), "categories.txt");
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const categories = parseCategoryList(fileContent);

    const fuse = new Fuse(categories, {
      keys: ["path"],
      includeScore: true,
      threshold: 0.4,
    });

    const result = fuse.search(generatedCategory);

    if (result.length > 0) {
      return json({
        path: result[0].item.path.split(" > "),
        id: result[0].item.id,
      });
    } else {
      return json({ path: null, id: null });
    }
  } catch (error) {
    console.error("Error finding category:", error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return json({ error: errorMessage }, { status: 500 });
  }
};
