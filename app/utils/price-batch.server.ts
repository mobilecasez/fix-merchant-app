/**
 * Price Radar bulk research — durable background job. Kicked off fire-and-forget (like the
 * web-tier scan) so the request returns immediately with "we'll email you when ready". It
 * researches each product with the grounded Gemini engine (chunked for throughput), saves
 * results to ProductPriceResearch (SEPARATE from the live price), tracks progress on the
 * PriceBatchJob row, and emails the merchant on completion.
 *
 * (This is the async job + email-when-ready UX the spec calls for; the per-item execution
 * can later be swapped to the true Gemini Batch API without touching the job lifecycle.)
 */
import prisma from "../db.server";
import { researchCompetitivePrice } from "./price-research.server";
import { sendEmail } from "./email.server";

export interface BatchProduct {
  productId: string;
  variantId: string;
  title: string;
  vendor?: string;
  productType?: string;
  currentPrice: number;
  currency: string;
  barcode?: string | null;
  imageUrl?: string | null;
}

const CONCURRENCY = 4;

export function startPriceBatch(jobId: string, shop: string, products: BatchProduct[]) {
  setImmediate(() => {
    processPriceBatch(jobId, shop, products).catch((e) => console.error("[price-batch] fatal:", e));
  });
}

async function processPriceBatch(jobId: string, shop: string, products: BatchProduct[]) {
  let processed = 0;
  try {
    await prisma.priceBatchJob.update({ where: { id: jobId }, data: { status: "processing" } }).catch(() => {});
    for (let i = 0; i < products.length; i += CONCURRENCY) {
      const chunk = products.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(async (p) => {
        try {
          const r = await researchCompetitivePrice({
            title: p.title, vendor: p.vendor, productType: p.productType,
            currentPrice: p.currentPrice, currency: p.currency, barcode: p.barcode,
          });
          const fields = {
            productTitle: p.title, imageUrl: p.imageUrl ?? null, currentPrice: p.currentPrice,
            currency: r.currency, researchedPrice: r.researchedPrice, priceLow: r.low, priceHigh: r.high,
            rationale: r.rationale, sources: r.sources, confidence: r.confidence,
            status: r.researchedPrice != null ? "researched" : "failed", batchJobId: jobId,
          };
          await prisma.productPriceResearch.upsert({
            where: { shop_variantId: { shop, variantId: p.variantId } },
            create: { shop, productId: p.productId, variantId: p.variantId, ...fields },
            update: { ...fields, appliedAt: null },
          });
        } catch (e) {
          console.error("[price-batch] item failed:", p.variantId, e);
        }
        processed++;
      }));
      await prisma.priceBatchJob.update({ where: { id: jobId }, data: { processedCount: processed } }).catch(() => {});
    }
    const job = await prisma.priceBatchJob.update({
      where: { id: jobId },
      data: { status: "complete", processedCount: processed, completedAt: new Date() },
    });
    if (job.email) {
      await sendEmail({ to: job.email, subject: `Your competitive price research is ready (${processed} products)`, html: batchEmailHtml(processed) });
      await prisma.priceBatchJob.update({ where: { id: jobId }, data: { notifiedAt: new Date() } }).catch(() => {});
    }
  } catch (err) {
    await prisma.priceBatchJob.update({
      where: { id: jobId },
      data: { status: "failed", error: String(err).slice(0, 300), processedCount: processed },
    }).catch(() => {});
  }
}

function batchEmailHtml(count: number): string {
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
    <h2 style="color:#10233f">Your competitive prices are ready 🎯</h2>
    <p>We finished researching market prices for <strong>${count} products</strong>.</p>
    <p>Open <strong>ShopFlix AI → Price Radar</strong> in your Shopify admin to review each suggested price and
    <strong>Apply</strong> the ones you want (you can edit any price before applying). Your live prices haven't
    changed — nothing is applied until you choose to.</p>
    <p style="color:#6b7280;font-size:13px">— ShopFlix AI</p>
  </div>`;
}
