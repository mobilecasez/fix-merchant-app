import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { processStoreScan, processAdvancedScan, processDeepScan, unlockStorefront } from "../utils/store-scanner.server";
import { incrementProductUsage, getOrCreateSubscription, getProductsUsed, getEffectiveProductLimit } from "../utils/billing.server";
import { extractReadableText } from "../utils/dom-optimizer.server";

const SCAN_CREDITS: Record<string, number> = {
  BASIC: 10,
  ADVANCED: 20,
  DEEP: 30,
};

/** GET — return the latest scan for this shop */
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });

  const scan = await (prisma as any).storeScan.findFirst({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });

  // Auto-reset scans stuck in PENDING/PROCESSING for more than 5 minutes
  if (scan && (scan.status === "PENDING" || scan.status === "PROCESSING")) {
    const ageMs = Date.now() - new Date(scan.updatedAt).getTime();
    if (ageMs > 5 * 60 * 1000) {
      const updated = await (prisma as any).storeScan.update({
        where: { id: scan.id },
        data: { status: "FAILED", error: "Scan timed out. Please try again." },
      });
      return json({ scan: updated });
    }
  }

  return json({ scan });
}

/** POST — start a new scan OR submit a store password for a NEEDS_PASSWORD scan */
export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const intent = (formData.get("intent") as string) || "start_scan";

  // ── Intent: user submitting password for a password-protected store ─────────
  if (intent === "submit_password") {
    const scanId = formData.get("scanId") as string;
    const storePassword = formData.get("storePassword") as string;

    if (!scanId || !storePassword?.trim()) {
      return json({ error: "Scan ID and store password are required." }, { status: 400 });
    }

    let existingScan: any;
    try {
      existingScan = await (prisma as any).storeScan.findUnique({ where: { id: scanId } });
    } catch {
      return json({ error: "Could not load scan." }, { status: 500 });
    }

    if (!existingScan || existingScan.status !== "NEEDS_PASSWORD") {
      return json({ error: "Scan not found or is not waiting for a password." }, { status: 400 });
    }

    const persisted = (existingScan.result as any) || {};
    const storeUrl = persisted.store_url;
    if (!storeUrl) {
      return json({ error: "Store URL not found in scan. Please start a new scan." }, { status: 400 });
    }

    const { cookie, error: unlockError } = await unlockStorefront(storeUrl, storePassword);
    if (!cookie) {
      return json({ error: unlockError || "Incorrect password. Please try again." }, { status: 401 });
    }

    await (prisma as any).storeScan.update({
      where: { id: scanId },
      data: { status: "PENDING", error: null },
    });

    // Resume the SAME scan type that was requested — the store is now unlocked.
    const resumeType = (existingScan.type as string) || persisted.scan_type || "BASIC";
    setImmediate(() => {
      const onError = (err: unknown) => console.error(`[${resumeType}Scan] Background error:`, err);
      if (resumeType === "ADVANCED") {
        processAdvancedScan(scanId, session.shop, storeUrl, persisted.products || [], true, cookie).catch(onError);
      } else if (resumeType === "DEEP") {
        const deepData = { ...(persisted.deepData || {}), is_password_protected: true };
        processDeepScan(scanId, session.shop, storeUrl, persisted.products || [], deepData, cookie).catch(onError);
      } else {
        processStoreScan(scanId, session.shop, storeUrl, cookie).catch(onError);
      }
    });

    return json({ scan: { ...existingScan, status: "PENDING" } });
  }

  // ── Intent: start a brand new scan ─────────────────────────────────────────
  const scanType = (formData.get("scanType") as string) || "BASIC";

  const subscription = await getOrCreateSubscription(session.shop);

  // First Basic scan is FREE (one per shop) so every new install can experience
  // the core value before the paywall — keeps the 2 free credits intact for fixes.
  const isFreeBasicScan = scanType === "BASIC" && !(subscription as any).freeBasicScanUsed;
  const credits = isFreeBasicScan ? 0 : (SCAN_CREDITS[scanType] ?? 10);

  const used = getProductsUsed(subscription);
  const limit = getEffectiveProductLimit(subscription);
  if (used + credits > limit) {
    return json({ error: "Not enough credits to run this scan. Please upgrade your plan." }, { status: 402 });
  }

  // Fetch store URL (needed by all scan types)
  const shopResponse = await admin.graphql(`#graphql
    query shopInfo {
      shop {
        name
        primaryDomain { url }
        contactEmail
        currencyCode
        billingAddress { address1 address2 city provinceCode zip countryCodeV2 phone }
      }
    }
  `);
  const shopData = await shopResponse.json();
  const storeUrl = shopData?.data?.shop?.primaryDomain?.url;

  if (!storeUrl) {
    return json({ error: "Could not determine store URL." }, { status: 400 });
  }

  // ── For ADVANCED & DEEP: fetch products BEFORE creating the scan record so a
  // GraphQL error doesn't leave an orphaned PENDING record. Deep chains the same
  // Basic + Advanced (product feed) checks before its own audit.
  let advancedProducts: any[] | null = null;
  if (scanType === "ADVANCED" || scanType === "DEEP") {
    const productsResponse = await admin.graphql(`#graphql
      query products($first: Int!) {
        products(first: $first) {
          edges {
            node {
              id
              title
              descriptionHtml
              onlineStoreUrl
              vendor
              variants(first: 1) {
                edges {
                  node {
                    id
                    price
                    compareAtPrice
                    sku
                    availableForSale
                    barcode
                  }
                }
              }
              images(first: 1) {
                edges {
                  node {
                    url
                    width
                    height
                  }
                }
              }
              metafields(first: 5, namespace: "custom") {
                edges {
                  node { key value }
                }
              }
            }
          }
        }
      }
    `, { variables: { first: 50 } });

    const productsData = await productsResponse.json();
    if (productsData?.errors) {
      return json({ error: `Could not fetch products: ${productsData.errors[0]?.message}` }, { status: 400 });
    }

    const rawProducts = productsData?.data?.products?.edges || [];
    advancedProducts = rawProducts.map((edge: any) => {
      const node = edge.node;
      const variant = node.variants?.edges?.[0]?.node || {};
      const image = node.images?.edges?.[0]?.node || {};
      const metafields: Record<string, string> = {};
      (node.metafields?.edges || []).forEach((mf: any) => {
        metafields[mf.node.key] = mf.node.value;
      });

      const description = extractReadableText(node.descriptionHtml || "", 500);
      const productPath = node.onlineStoreUrl || `${storeUrl}/products/${node.id.split("/").pop()}`;

      return {
        id: node.id,
        title: node.title || "",
        description,
        link: productPath,
        image_url: image.url || "",
        image_width: image.width || 0,
        image_height: image.height || 0,
        gtin: variant.barcode || metafields["gtin"] || null,
        mpn: variant.sku || metafields["mpn"] || null,
        brand: node.vendor || metafields["brand"] || null,
        price: parseFloat(variant.price || "0"),
        compare_at_price: variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null,
        weight: null,
        availability: variant.availableForSale ? "in stock" : "out of stock",
      };
    });
  }

  // ── Charge credits and create the record only after all data fetching succeeds
  for (let i = 0; i < credits; i++) {
    await incrementProductUsage(session.shop);
  }

  // Consume the one-time free Basic scan so subsequent scans are credit-based.
  if (isFreeBasicScan) {
    await prisma.shopSubscription.update({
      where: { shop: session.shop },
      data: { freeBasicScanUsed: true } as any,
    }).catch((e) => console.error("[StoreScan] Could not mark free basic scan used:", e));
  }

  const scan = await (prisma as any).storeScan.create({
    data: { shop: session.shop, type: scanType, status: "PENDING" },
  });

  if (scanType === "BASIC") {
    setImmediate(() => {
      processStoreScan(scan.id, session.shop, storeUrl).catch((err) =>
        console.error("[StoreScan] Background error:", err)
      );
    });
    return json({ scan });
  }

  if (scanType === "ADVANCED" && advancedProducts) {
    setImmediate(() => {
      processAdvancedScan(scan.id, session.shop, storeUrl, advancedProducts!).catch((err) =>
        console.error("[AdvancedScan] Background error:", err)
      );
    });
    return json({ scan });
  }

  if (scanType === "DEEP") {
    const shopInfo = shopData?.data?.shop || {};
    const shopName = shopInfo.name || "";
    const domain = storeUrl.replace(/^https?:\/\//, "");
    const addr = shopInfo.billingAddress || {};
    const legalAddress = [addr.address1, addr.city, addr.countryCodeV2].filter(Boolean).join(", ");
    // Full billing address + registrable domain — feed the Trust & Identity layer (registered-agent
    // match, brand-geography, NAP). Best-effort; every field is optional/null-safe downstream.
    const addressFull = [addr.address1, addr.address2, addr.city, addr.provinceCode, addr.zip, addr.countryCodeV2].filter(Boolean).join(", ");
    let registrableTld = "";
    try { registrableTld = new URL(storeUrl).hostname.replace(/^www\./, "").split(".").slice(-2).join("."); } catch { /* keep empty */ }

    // Fetch contact page text
    let contactPageText = "";
    try {
      const contactRes = await fetch(`${storeUrl}/pages/contact`, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" },
        signal: AbortSignal.timeout(10000),
      });
      if (contactRes.ok) {
        const html = await contactRes.text();
        // Clean, readable text only — strips inline JS/CSS so the AI sees the
        // actual contact details instead of "mostly code".
        contactPageText = extractReadableText(html, 2500);
      }
    } catch { /* non-fatal */ }

    // Fetch a sample product's page to extract JSON-LD schema and visual price
    let jsonLdSchema = "{}";
    let visualDomPrice = "unknown";

    try {
      const productsResp = await admin.graphql(`#graphql
        query firstProduct {
          products(first: 1) {
            edges {
              node {
                onlineStoreUrl
                variants(first: 1) { edges { node { price } } }
              }
            }
          }
        }
      `);
      const pd = await productsResp.json();
      const firstProduct = pd?.data?.products?.edges?.[0]?.node;
      const productUrl = firstProduct?.onlineStoreUrl;
      const listedPrice = firstProduct?.variants?.edges?.[0]?.node?.price || "0";

      if (productUrl) {
        const pageRes = await fetch(productUrl, {
          headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" },
          signal: AbortSignal.timeout(12000),
        });
        if (pageRes.ok) {
          const html = await pageRes.text();
          const ldMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
          if (ldMatch) {
            try {
              const parsed = JSON.parse(ldMatch[1].trim());
              jsonLdSchema = JSON.stringify(parsed).substring(0, 1000);
            } catch { jsonLdSchema = ldMatch[1].substring(0, 500); }
          }
          // Extract visual price from common Shopify price selectors
          const priceMatch = html.match(/class="[^"]*price[^"]*"[^>]*>\s*([^<]{1,30})</i);
          visualDomPrice = priceMatch ? priceMatch[1].trim() : listedPrice;
        }
      }
    } catch { /* non-fatal */ }

    // Fetch installed apps from script tags (heuristic — public app names are not exposed via API)
    const appsResponse = await admin.graphql(`#graphql
      query scriptTags {
        scriptTags(first: 50) {
          edges { node { src } }
        }
      }
    `);
    const appsData = await appsResponse.json();
    const scriptSrcs: string[] = (appsData?.data?.scriptTags?.edges || []).map((e: any) => e.node.src as string);

    // Map known deceptive-app domains to readable names
    const KNOWN_DECEPTIVE_PATTERNS: Array<[RegExp, string]> = [
      [/countdown-timer/i, "Countdown Timer app"],
      [/urgency/i, "Urgency app"],
      [/scarcity/i, "Scarcity app"],
      [/fake.*visitor/i, "Fake Visitor Counter app"],
      [/hurrify/i, "Hurrify"],
      [/sales-pop/i, "Sales Pop app"],
      [/fomo\.com/i, "FOMO"],
      [/beeketing/i, "Beeketing"],
      [/sumo\.com/i, "Sumo"],
    ];

    const activeThirdPartyApps: string[] = [];
    for (const src of scriptSrcs) {
      for (const [pattern, name] of KNOWN_DECEPTIVE_PATTERNS) {
        if (pattern.test(src) && !activeThirdPartyApps.includes(name)) {
          activeThirdPartyApps.push(name);
        }
      }
    }
    // Also include all unique script domains for reference
    const scriptDomains = Array.from(new Set(scriptSrcs.map(s => {
      try { return new URL(s).hostname; } catch { return s; }
    }))).slice(0, 20);
    activeThirdPartyApps.push(...scriptDomains.filter(d => !activeThirdPartyApps.some(a => a.includes(d))));

    const deepData = {
      is_password_protected: false,
      business_identity: { name: shopName, domain, legal_address: legalAddress, contact_email: shopInfo.contactEmail || "" },
      contact_page_text: contactPageText,
      sample_product: {
        json_ld_schema: jsonLdSchema,
        visual_dom_price: visualDomPrice,
        simulated_checkout_price: visualDomPrice, // we can't simulate real checkout without a user session
      },
      active_third_party_apps: activeThirdPartyApps,
      // Identity ground-truth for the Trust & Identity layer (enrichDeepData populates the rest).
      store_meta: {
        phone: addr.phone || null,
        currency: shopInfo.currencyCode || null,
        country_code: addr.countryCodeV2 || null,
        address_full: addressFull || null,
        tld: registrableTld || null,
      },
    };

    setImmediate(() => {
      processDeepScan(scan.id, session.shop, storeUrl, advancedProducts || [], deepData).catch((err) =>
        console.error("[DeepScan] Background error:", err)
      );
    });

    return json({ scan });
  }

  return json({ error: "Unknown scan type." }, { status: 400 });
}
