import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import sharp from "sharp";
import {
  incrementProductUsage, getOrCreateSubscription, getProductsUsed, getEffectiveProductLimit,
} from "../utils/billing.server";

const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image"; // GA "Nano Banana"
const SCAN_CREDIT = 10;
const FIX_CREDIT = 2;
const TARGET = 1200; // final square size (GMC-friendly)
const OVERLAY_RE = /(^|[/_\-.])(sale|promo|promotion|watermark|discount|offer|deal|off)([/_\-.]|$|\d)/i;

// ── Image helpers ─────────────────────────────────────────────────────────────

async function downloadImage(url: string): Promise<{ buffer: Buffer; mime: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Could not download image (${res.status})`);
  const mime = res.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mime };
}

/** Normalize any image to a clean GMC-friendly square on a white background. */
async function toCompliantSquare(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(TARGET, TARGET, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/**
 * Edit the image with Gemini (white background + remove overlays/text/watermarks).
 * Returns the edited bytes, or null if the model is unavailable (e.g. no billing
 * on the key — image output is paid-only) so the caller can fall back to sharp.
 */
async function geminiEditImage(buffer: Buffer): Promise<Buffer | null> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    // Downscale input to keep the request small + within limits, normalize to JPEG.
    const input = await sharp(buffer).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
    const body = {
      contents: [{
        parts: [
          { text: "Edit this product photo for an online store catalog: place the product on a clean, pure white (#FFFFFF) studio background. Remove ALL promotional text, watermarks, logos, badges, price tags, stickers, and any graphic overlays. Keep the product itself completely unchanged — same shape, color and details — well-lit, centered and sharp. Output a single clean product image." },
          { inline_data: { mime_type: "image/jpeg", data: input.toString("base64") } },
        ],
      }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) {
      console.warn(`[image-fixer] Gemini image edit failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data: any = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const imgPart = parts.find((p: any) => p.inlineData || p.inline_data);
    if (!imgPart) return null;
    const inline = imgPart.inlineData || imgPart.inline_data;
    return Buffer.from(inline.data, "base64");
  } catch (e: any) {
    console.warn("[image-fixer] Gemini edit exception:", e.message);
    return null;
  }
}

// ── Shopify upload flow (staged → createMedia → poll READY) ───────────────────

async function uploadImageToShopify(admin: any, productId: string, buffer: Buffer, filename: string): Promise<{ mediaId: string; url: string }> {
  // 1. Staged upload target (resource IMAGE, POST → GCS multipart)
  const stagedResp = await admin.graphql(`#graphql
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }
  `, { variables: { input: [{ filename, mimeType: "image/jpeg", resource: "IMAGE", httpMethod: "POST", fileSize: String(buffer.length) }] } });
  const stagedData = await stagedResp.json();
  const sErr = stagedData?.data?.stagedUploadsCreate?.userErrors;
  if (sErr?.length) throw new Error(sErr[0].message);
  const target = stagedData?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) throw new Error("No staged upload target returned.");

  // 2. Multipart POST — parameters FIRST (in order), file LAST (mandatory).
  const form = new FormData();
  for (const { name, value } of target.parameters) form.append(name, value);
  form.append("file", new Blob([buffer], { type: "image/jpeg" }), filename);
  const upRes = await fetch(target.url, { method: "POST", body: form, signal: AbortSignal.timeout(30000) });
  if (upRes.status !== 201 && upRes.status !== 200) {
    throw new Error(`Staged upload failed: ${upRes.status} ${(await upRes.text()).slice(0, 200)}`);
  }

  // 3. Attach to product.
  const createResp = await admin.graphql(`#graphql
    mutation productCreateMedia($media: [CreateMediaInput!]!, $productId: ID!) {
      productCreateMedia(media: $media, productId: $productId) {
        media { ... on MediaImage { id status image { url } mediaErrors { code details message } } }
        mediaUserErrors { field message }
      }
    }
  `, { variables: { productId, media: [{ originalSource: target.resourceUrl, mediaContentType: "IMAGE", alt: "Compliant product image" }] } });
  const createData = await createResp.json();
  const cErr = createData?.data?.productCreateMedia?.mediaUserErrors;
  if (cErr?.length) throw new Error(cErr[0].message);
  const media = createData?.data?.productCreateMedia?.media?.[0];
  if (!media?.id) throw new Error("Image upload did not return a media id.");

  // 4. Poll until READY.
  let url = media.image?.url || "";
  for (let i = 0; i < 20 && (!url || media.status !== "READY"); i++) {
    await new Promise(r => setTimeout(r, 1500));
    const nodeResp = await admin.graphql(`#graphql
      query mediaStatus($id: ID!) {
        node(id: $id) { ... on MediaImage { id status image { url } mediaErrors { code details message } } }
      }
    `, { variables: { id: media.id } });
    const node = (await nodeResp.json())?.data?.node;
    if (node?.status === "FAILED") throw new Error(`Image processing failed: ${JSON.stringify(node.mediaErrors)}`);
    if (node?.status === "READY") { url = node.image?.url || ""; break; }
  }
  return { mediaId: media.id, url };
}

// ── Action ────────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const bodyClone = request.clone();
  const { admin, session } = await authenticate.admin(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });

  const body = await bodyClone.json().catch(() => ({}));
  const intent = body.intent;

  // ── Scan: list products whose featured image has a compliance problem ───────
  if (intent === "scan") {
    // Credit check — scanning the catalog for image issues costs SCAN_CREDIT.
    const sub = await getOrCreateSubscription(session.shop);
    const used = getProductsUsed(sub);
    const limit = getEffectiveProductLimit(sub);
    if (used + SCAN_CREDIT > limit) {
      return json({ error: `Not enough credits. An image scan costs ${SCAN_CREDIT} credits. You have ${limit - used} remaining.` }, { status: 402 });
    }

    const out: any[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 4; page++) {
      const resp: any = await admin.graphql(`#graphql
        query products($cursor: String) {
          products(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            edges { node { id title featuredImage { url width height altText } } }
          }
        }
      `, { variables: { cursor } });
      const data = await resp.json();
      const conn = data?.data?.products;
      if (!conn) break;
      for (const e of conn.edges) {
        const img = e.node.featuredImage;
        if (!img?.url) { out.push({ productId: e.node.id, title: e.node.title, imageUrl: null, issues: ["No image"] }); continue; }
        const issues: string[] = [];
        const w = img.width || 0, h = img.height || 0;
        if (w && h && (w < 600 || h < 600)) issues.push(`Low resolution (${w}×${h})`);
        if (w && h && Math.abs(w - h) / Math.max(w, h) > 0.25) issues.push("Not square");
        if (OVERLAY_RE.test(img.url) || OVERLAY_RE.test(img.altText || "")) issues.push("Possible promo text / overlay");
        if (issues.length) out.push({ productId: e.node.id, title: e.node.title, imageUrl: img.url, width: w, height: h, issues });
      }
      if (!conn.pageInfo?.hasNextPage) break;
      cursor = conn.pageInfo.endCursor;
    }
    for (let i = 0; i < SCAN_CREDIT; i++) await incrementProductUsage(session.shop);
    return json({ success: true, products: out, creditsUsed: SCAN_CREDIT });
  }

  // ── Fix: regenerate a compliant image for one product, re-upload, set featured ─
  if (intent === "fix") {
    const productId = body.productId;
    const useAI = body.useAI !== false; // default true
    if (!productId) return json({ error: "productId is required." }, { status: 400 });

    // Credit check
    const sub = await getOrCreateSubscription(session.shop);
    const used = getProductsUsed(sub);
    const limit = getEffectiveProductLimit(sub);
    if (used + FIX_CREDIT > limit) {
      return json({ error: `Not enough credits. Fixing an image costs ${FIX_CREDIT} credits. You have ${limit - used} remaining.` }, { status: 402 });
    }

    try {
      // Get the product's first media image (the featured target).
      const mResp = await admin.graphql(`#graphql
        query productMedia($id: ID!) {
          product(id: $id) {
            title
            media(first: 10) { edges { node { ... on MediaImage { id image { url } } } } }
          }
        }
      `, { variables: { id: productId } });
      const mData = await mResp.json();
      const mediaNodes = (mData?.data?.product?.media?.edges || []).map((e: any) => e.node).filter((n: any) => n?.id && n?.image?.url);
      const target = mediaNodes[0];
      if (!target) return json({ error: "This product has no image to fix." }, { status: 400 });

      // Download → AI edit (fallback sharp) → normalize to compliant square.
      const { buffer: original } = await downloadImage(target.image.url);
      let method: "ai" | "enhanced" = "enhanced";
      let working = original;
      if (useAI) {
        const edited = await geminiEditImage(original);
        if (edited) { working = edited; method = "ai"; }
      }
      const finalBuffer = await toCompliantSquare(working);

      // Upload the compliant image and set it as FEATURED (position 0). NON-DESTRUCTIVE:
      // we do NOT delete the merchant's original — it stays in the gallery (Shopify has no
      // image version history, so a delete is irrecoverable, and the AI edit isn't guaranteed
      // to preserve the product faithfully). GMC only uses the featured/first image anyway.
      const filename = `compliant-${Date.now()}.jpg`;
      const { mediaId: newMediaId, url: newUrl } = await uploadImageToShopify(admin, productId, finalBuffer, filename);

      // Set new image to position 0 (featured).
      await admin.graphql(`#graphql
        mutation reorder($id: ID!, $moves: [MoveInput!]!) {
          productReorderMedia(id: $id, moves: $moves) { job { id } mediaUserErrors { field message } }
        }
      `, { variables: { id: productId, moves: [{ id: newMediaId, newPosition: "0" }] } }).catch(() => {});

      for (let i = 0; i < FIX_CREDIT; i++) await incrementProductUsage(session.shop);

      return json({
        success: true,
        method,
        newImageUrl: newUrl,
        message: method === "ai"
          ? "Image cleaned with AI (white background + overlays removed) and set as the main product image."
          : "Image enhanced (resized onto a clean white square) and set as the main product image.",
      });
    } catch (err: any) {
      console.error("[image-fixer] fix failed:", err);
      return json({ error: `Could not fix image: ${err.message}` }, { status: 500 });
    }
  }

  return json({ error: "Unknown intent." }, { status: 400 });
}
