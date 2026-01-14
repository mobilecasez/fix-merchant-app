import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // GDPR: Customer data request
  // When a customer requests their data, you need to provide it
  // Since this app doesn't store customer data, we acknowledge the request
  
  if (payload) {
    const data = JSON.parse(payload.toString());
    console.log("Customer data request:", {
      shop,
      customer_id: data.customer?.id,
      orders_requested: data.orders_requested,
    });
  }

  // Return 200 to acknowledge receipt
  // In a real scenario, you would email the customer their data
  return new Response(null, { status: 200 });
};
