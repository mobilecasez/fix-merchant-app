import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * APP SCOPES UPDATE WEBHOOK
 * Triggered: When app permissions (scopes) are changed in Partner Dashboard
 * Purpose: Update stored session scopes to match new permissions
 * 
 * Example scenarios:
 * - Developer adds new scopes (read_orders, write_customers)
 * - Developer removes unnecessary scopes
 * - Merchant re-authorizes app with updated permissions
 * 
 * This ensures the session data stays in sync with actual permissions
 */
export const action = async ({ request }: ActionFunctionArgs) => {
    const { payload, session, topic, shop } = await authenticate.webhook(request);
    console.log(`✅ Received ${topic} webhook for ${shop}`);

    const current = payload.current as string[];
    console.log(`📝 Updated scopes:`, current);
    
    if (session) {
        await db.session.update({   
            where: {
                id: session.id
            },
            data: {
                scope: current.toString(),
            },
        });
        console.log(`✓ Session scopes updated for ${shop}`);
    }
    return new Response();
};
