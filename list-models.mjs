import "dotenv/config";

async function listModels() {
  try {
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    console.log("Available models that support 'generateContent':");
    if (data.models) {
      for (const model of data.models) {
        if (model.supportedGenerationMethods?.includes("generateContent")) {
          console.log(model.name);
        }
      }
    } else {
      console.log("API Response:", JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error("Error listing models:", error);
  }
}

listModels();
