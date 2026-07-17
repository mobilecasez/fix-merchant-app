import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { classifyOrder } from "../utils/product-analytics.server";

// Diagnostic: returns the RAW Shopify order JSON we read (fulfillment status, tracking, return
// status, note, tags, cancellation) for one order, plus how our classifier interprets it. This is
// the ACTUAL data source — the app does not call Delhivery/Blue Dart; "In Transit" etc. is
// Shopify's own fulfillment displayStatus, only as fresh as whatever courier app updates Shopify.
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);

  const grantedScopes = String((session as any).scope || "");
  if (!/read_orders/.test(grantedScopes)) {
    return json({ ok: false, error: "The read_orders permission is required." }, { status: 403 });
  }

  const url = new URL(request.url);
  const raw = (url.searchParams.get("q") || "").trim();
  if (!raw) return json({ ok: false, error: "Pass ?q=<order number>." }, { status: 400 });
  // Match by order name with or without a leading '#'.
  const clean = raw.replace(/[^0-9A-Za-z._-]/g, "");
  const q = `name:${clean}`;

  try {
    const resp: any = await admin.graphql(
      `#graphql
      query orderDebug($q: String!) {
        orders(first: 5, query: $q, sortKey: CREATED_AT, reverse: true) {
          nodes {
            id name createdAt cancelledAt cancelReason
            displayFulfillmentStatus displayFinancialStatus returnStatus
            paymentGatewayNames note tags
            fulfillments(first: 20) {
              name status displayStatus createdAt updatedAt deliveredAt inTransitAt estimatedDeliveryAt
              trackingInfo { company number url }
            }
            returns(first: 10) { nodes { id name status } }
            lineItems(first: 50) { nodes { title quantity discountedTotalSet { shopMoney { amount currencyCode } } } }
          }
        }
      }`,
      { variables: { q } },
    );
    const data = await resp.json();
    const nodes = data?.data?.orders?.nodes || [];
    if (data?.errors?.length) {
      return json({ ok: false, error: "Shopify GraphQL error", graphQLErrors: data.errors, matched: nodes.length }, { status: 502 });
    }
    if (!nodes.length) return json({ ok: false, error: `No order found matching "${raw}".` }, { status: 404 });

    const results = nodes.map((order: any) => {
      const c = classifyOrder(order);
      return {
        classifiedAs: c.classification,
        why: c.reasons,
        note: "This is Shopify order data (not Delhivery). Our 'In Transit'/'Delivered'/'Returned' comes from displayFulfillmentStatus + returnStatus + fulfillments[].displayStatus + note/tags below.",
        shopifyOrder: order,
      };
    });
    return json({ ok: true, query: q, matched: nodes.length, results });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e).slice(0, 500) }, { status: 502 });
  }
}
