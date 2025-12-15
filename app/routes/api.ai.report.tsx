import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { retryOperation } from "../utils/retry.js";
import ExcelJS from 'exceljs';
import nodemailer from 'nodemailer';
import { Buffer } from 'buffer'; // Explicitly import Buffer

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);
const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';

// Define a helper function for logging background errors, accessible globally
const logBackgroundError = (error: any) => {
  console.error("Background process error:", error);
};

// Function to handle the background processing
async function processAndSendReport(
  admin: any, // Use the already authenticated admin object
  products: any[],
) {
  // Get shop owner's email within the background process
  let shopOwnerEmail: string | undefined;
  let shopCurrencyCode: string | undefined;
  try {
    // Use the passed admin object directly, no need to re-authenticate
    const shopResponse = await admin.graphql(
      `#graphql
        query shopInfo {
          shop {
            email
            currencyCode
          }
        }`
    );
    const shopData = await shopResponse.json();
    shopOwnerEmail = shopData.data?.shop?.email;
    shopCurrencyCode = shopData.data?.shop?.currencyCode;
    if (!shopOwnerEmail) {
      console.warn("Shop owner email not found for background report.");
    }
    if (!shopCurrencyCode) {
      console.warn("Shop currency code not found for background report.");
    }
  } catch (error) {
    console.error("Error fetching shop email or currency in background:", error);
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json", // Ensure JSON output
    },
  });

  const concurrencyLimit = 5; // Limit to 5 concurrent AI requests
  const productAnalysisResults: any[] = [];
  let samplePrompt: string | undefined;
  let sampleAiResponse: any | undefined;

  for (let i = 0; i < products.length; i += concurrencyLimit) {
    const chunk = products.slice(i, i + concurrencyLimit);
    const chunkPromises = chunk.map(async (product: any) => {
      const productIssues: any[] = [];
      // Perform local deterministic check for compareAtPrice vs price
      if (product.compareAtPrice === null || product.compareAtPrice <= product.price) {
        productIssues.push({
          message: "Google Merchant Center: compareAtPrice must exist and be greater than price.",
          severity: "High"
        });
      }

      // If local checks found issues, return them immediately without calling AI
      if (productIssues.length > 0) {
        return {
          id: product.id,
          product_name: product.title,
          issues: productIssues,
          suggestions_for_sales_improvement: [], // No AI suggestions if we skip AI call
        };
      }

      const productForAI = {
        id: product.id,
        title: product.title,
        handle: product.handle,
        description: product.description,
        metaDescription: product.metaDescription,
        price: product.price,
        compareAtPrice: product.compareAtPrice,
        currencyCode: shopCurrencyCode, // Add currency code to the product object for AI
      };

      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.toLocaleString('default', { month: 'long' });
      const currentDay = currentDate.getDate();

      const prompt = `
      You are a world-class e-commerce and SEO expert. Your task is to perform a meticulous and exhaustive analysis of the following Shopify product. A summarized or incomplete response is unacceptable. You must identify every possible issue related to Google Merchant Center, SEO, and Google Ads. Be thorough and do not omit any findings, no matter how small.

      Crucially, you must also analyze the product's pricing: the \`compareAtPrice\` must exist and be greater than the \`price\`. If this condition is not met, it is a High severity issue for Google Merchant Center. The currency for the prices is ${shopCurrencyCode || 'USD'}.
      
      After identifying all issues, provide a detailed list of actionable suggestions to improve sales.

      For this product, return a JSON object. This object must contain:
      1.  The original "id" of the product.
      2.  A "product_name" key with the product's title.
      3.  An "issues" key, which is an array of objects containing every issue you identify. Each issue object must have a "message" and a "severity" (High, Medium, or Low).
      4.  A "suggestions_for_sales_improvement" key, which is an array of objects. Each object must have a "suggestion" (as a string, without markdown) and a "priority" ('High', 'Medium', or 'Low').

      The product is:
      ${JSON.stringify(productForAI, null, 2)}

      Please ensure your analysis is based on current product availability as of ${currentMonth} ${currentDay}, ${currentYear}, and avoid making assumptions about unreleased or hypothetical product models.

      Example response format for a single product (ensure your response is only the JSON object):
      {
        "id": "gid://shopify/Product/123",
        "product_name": "Example Product Title",
        "issues": [
          {
            "message": "Example issue message.",
            "severity": "High"
          }
        ],
        "suggestions_for_sales_improvement": [
          { "suggestion": "Example suggestion.", "priority": "High" }
        ]
      }
      `;

      const maxRetries = 3;
      const initialRetryDelayMs = 1000; // 1 second

      try {
        const aiResponseText = await retryOperation(async () => {
          const result = await Promise.race([
            model.generateContent(prompt),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('AI response timed out')), 120000) // Increased to 120 seconds (2 minutes) timeout
            ),
          ]);
          const response = await (result as any).response;
          return response.text();
        }, 5, initialRetryDelayMs, product.id); // Increased maxRetries to 5

        const startIndex = aiResponseText.indexOf('{');
        const endIndex = aiResponseText.lastIndexOf('}');
        const jsonString = aiResponseText.substring(startIndex, endIndex + 1);
        
        const parsedResponse = JSON.parse(jsonString);

        if (IS_DEVELOPMENT && !samplePrompt) {
          samplePrompt = prompt;
          sampleAiResponse = parsedResponse;
        }

        return parsedResponse;
      } catch (error: any) {
        console.error(`Final attempt failed for product ${product.id}:`, error);
        return {
          id: product.id,
          product_name: product.title,
          issues: [{ message: `Failed to get AI response for this product after multiple retries: ${error.message}`, severity: "High" }],
          suggestions_for_sales_improvement: [],
        };
      }
    });

    const chunkResults = await Promise.allSettled(chunkPromises);
    chunkResults.forEach(result => {
      if (result.status === 'fulfilled') {
        productAnalysisResults.push(result.value);
      } else {
        console.error("Promise rejected:", result.reason);
        const productIdMatch = result.reason.message.match(/for product (gid:\/\/shopify\/Product\/\d+)/);
        const productId = productIdMatch ? productIdMatch[1] : 'unknown';
        productAnalysisResults.push({
          id: productId,
          product_name: `Product ${productId} (Error)`,
          issues: [{ message: `Failed to get AI response for this product: ${result.reason.message}`, severity: "High" }],
          suggestions_for_sales_improvement: [],
        });
      }
    });
  }

  // Generate Excel file
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('AI Product Report');

  worksheet.columns = [
    { header: 'Product Title', key: 'product_name', width: 50 },
    { header: 'Type', key: 'type', width: 15 }, // 'Issue' or 'Suggestion'
    { header: 'Severity/Priority', key: 'severity_priority', width: 20 },
    { header: 'Description', key: 'description', width: 100 },
  ];

  const getFillColor = (tone: string) => {
    switch (tone) {
      case 'High':
      case 'critical':
        return { type: "pattern", pattern: 'solid', fgColor: { argb: 'FFFF0000' } } as ExcelJS.Fill; // Red
      case 'Medium':
      case 'warning':
        return { type: "pattern", pattern: 'solid', fgColor: { argb: 'FFFFA500' } } as ExcelJS.Fill; // Orange
      case 'Low':
      case 'attention':
        return { type: "pattern", pattern: 'solid', fgColor: { argb: 'FFFFFF00' } } as ExcelJS.Fill; // Yellow
      default:
        return { type: "pattern", pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } } as ExcelJS.Fill; // White default
    }
  };

  productAnalysisResults.forEach(product => {
    let firstRowForProduct = true;

    // Add issues
    product.issues.forEach((issue: any) => {
      const row = worksheet.addRow({
        product_name: firstRowForProduct ? product.product_name : '',
        type: 'Issue',
        severity_priority: issue.severity,
        description: issue.message,
      });
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = getFillColor(issue.severity);
      });
      firstRowForProduct = false;
    });

    // Add suggestions
    product.suggestions_for_sales_improvement.forEach((suggestion: any) => {
      const row = worksheet.addRow({
        product_name: firstRowForProduct ? product.product_name : '',
        type: 'Suggestion',
        severity_priority: suggestion.priority,
        description: suggestion.suggestion,
      });
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = getFillColor(suggestion.priority);
      });
      firstRowForProduct = false;
    });

    // Add an empty row for separation if there were any issues or suggestions
    if (product.issues.length > 0 || product.suggestions_for_sales_improvement.length > 0) {
      worksheet.addRow({});
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const nodeBuffer = Buffer.from(buffer); // Convert ArrayBuffer to Node.js Buffer

  if (IS_DEVELOPMENT && shopOwnerEmail) { // Only send email in development if email is found
    const transporter = nodemailer.createTransport({
      host: "smtp.zoho.in",
      port: 465,
      secure: true, // Use SSL
      auth: {
        user: "Shopify-app@mobilecasez.com",
        pass: "Ab!12345", // This should ideally be from environment variables
      },
    });

    try {
      await transporter.sendMail({
        from: '"Shopify App" <Shopify-app@mobilecasez.com>',
        to: shopOwnerEmail,
        subject: 'Your Detailed AI Product Report',
        html: '<p>Please find attached your detailed AI product report.</p>',
        attachments: [{
          filename: 'AI_Product_Report.xlsx',
          content: nodeBuffer, // Use Node.js Buffer
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }]
      });
      console.log(`Detailed AI Report sent to ${shopOwnerEmail}.`);
    } catch (emailError: any) {
      console.error("Error sending email:", emailError);
    }
  } else if (!IS_DEVELOPMENT) { // In production, always attempt to send email if email is found
    if (shopOwnerEmail) {
      const transporter = nodemailer.createTransport({
        host: "smtp.zoho.in",
        port: 465,
        secure: true, // Use SSL
        auth: {
          user: "Shopify-app@mobilecasez.com",
          pass: "Ab!12345", // This should ideally be from environment variables
        },
      });
      try {
        await transporter.sendMail({
          from: '"Shopify App" <Shopify-app@mobilecasez.com>',
          to: shopOwnerEmail,
          subject: 'Your Detailed AI Product Report',
          html: '<p>Please find attached your detailed AI product report.</p>',
          attachments: [{
            filename: 'AI_Product_Report.xlsx',
            content: nodeBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          }]
        });
        console.log(`Detailed AI Report sent to ${shopOwnerEmail}.`);
      } catch (emailError: any) {
        console.error("Error sending email:", emailError);
      }
    } else {
      console.warn("Detailed AI Report generated. Shop owner email not found, so report cannot be sent via email.");
    }
  } else {
    console.warn("Detailed AI Report generated. Email not sent in development mode without a shop owner email.");
  }

  // Return data for development mode downloads
  if (IS_DEVELOPMENT) {
    return { products, excelBuffer: nodeBuffer.toString('base64'), samplePrompt, sampleAiResponse };
  }
  return {}; // No return value needed in production for background process
}

export async function action({ request }: ActionFunctionArgs) {
  const clonedRequest = request.clone(); // Clone the request before authentication
  const { admin, session } = await authenticate.admin(clonedRequest);
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const products = await request.json(); // Expect products directly as JSON body

  if (!products || !Array.isArray(products)) {
    return json({ error: "Invalid request body: expected an array of products" }, { status: 400 });
  }

  // Declare shopOwnerEmail and shopCurrencyCode outside the try-catch block
  let shopOwnerEmail: string | undefined = undefined; 
  let shopCurrencyCode: string | undefined = undefined;
  try {
    const shopResponse = await admin.graphql(
      `#graphql
        query shopInfo {
          shop {
            email
            currencyCode
          }
        }`
    );
    const shopData = await shopResponse.json();
    shopOwnerEmail = shopData.data?.shop?.email;
    shopCurrencyCode = shopData.data?.shop?.currencyCode;
    if (!shopOwnerEmail) {
      console.warn("Shop owner email not found.");
    }
    if (!shopCurrencyCode) {
      console.warn("Shop currency code not found.");
    }
  } catch (error) {
    console.error("Error fetching shop email or currency:", error);
  }

  // Trigger the background processing without awaiting it
  // Pass the already authenticated admin object
  processAndSendReport(admin, products).catch(logBackgroundError);

  return json({ 
    success: true, 
    message: `Report generation started in the background. You will receive an email shortly.`, 
    shopOwnerEmail,
  });
}
