import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const { rating, dismissed } = await request.json();

  try {
    // Upsert review record
    const review = await prisma.shopReview.upsert(
      {
        where: { shop: session.shop },
        update: {
          ...(rating !== undefined && { rating }),
          ...(dismissed !== undefined && { dismissed }),
          updatedAt: new Date(),
        },
        create: {
          shop: session.shop,
          ...(rating !== undefined && { rating }),
          ...(dismissed !== undefined && { dismissed }),
        },
      }
    );

    return json({ success: true, review });
  } catch (error) {
    console.error("Error submitting rating:", error);
    return json(
      { error: "Failed to submit rating" },
      { status: 500 }
    );
  }
};
