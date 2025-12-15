import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

async function run() {
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });

  const prompt = `
    Generate a feature heading and a detailed description for the following feature request.
    The feature is: "User can just enter the url from any online e-commerce website to create the product automatically in its store with images and everything, and based on the URL.. all the details will be fetched on the Product Create Form.. that will have all the fields like Shopify default Product add form"

    The output should be in markdown format, with a heading and a description.
  `;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  const text = response.text();
  console.log(text);
}

run();
