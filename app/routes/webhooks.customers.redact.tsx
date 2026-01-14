import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // GDPR: Customer data erasure request
  // Delete all customer-related data when requested
  
  if (payload) {
    const data = JSON.parse(payload.toString());
    const customerId = data.customer?.id;
    
    console.log("Customer redaction request:", {
      shop,
      customer_id: customerId,
    });

    // This app doesn't store customer data, so nothing to delete
    // If you stored customer data, delete it here:
    // await db.customerData.deleteMany({ where: { customerId } });
  }

  return new Response(null, { status: 200 });
};
