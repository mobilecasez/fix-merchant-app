/**
 * Lightweight job tracker for long-running AI generations (profit report, campaign plan).
 * The heavy Gemini call runs DETACHED from the HTTP request — the click returns immediately,
 * the client polls the loader, and the finished payload lands in its AiReport row. Job state
 * lives in a sibling AiReport row (kind: "<thing>_job") so no new table is needed.
 */
import prisma from "../db.server";

export type AiJobStatus = "running" | "done" | "error";
export interface AiJobMeta {
  status: AiJobStatus;
  error?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  model?: string | null;
}

export async function setAiJob(shop: string, kind: string, meta: AiJobMeta): Promise<void> {
  await prisma.aiReport.upsert({
    where: { shop_kind: { shop, kind } },
    update: { data: {}, meta: meta as any },
    create: { shop, kind, data: {}, meta: meta as any },
  }).catch((e) => console.error(`[ai-job] ${kind} save failed:`, e?.message));
}

export async function getAiJob(shop: string, kind: string): Promise<AiJobMeta | null> {
  const r = await prisma.aiReport.findUnique({ where: { shop_kind: { shop, kind } } }).catch(() => null);
  return r ? ((r.meta as any) || null) : null;
}

/** Loader-facing view: a "running" job older than `staleMinutes` reads as stale (server restart
 *  etc). Must exceed the job's withTimeout budget, or a legitimately long run reads as dead. */
export function jobView(meta: AiJobMeta | null, staleMinutes = 15): { status: string; error?: string | null; startedAt?: string } | null {
  if (!meta || !meta.status) return null;
  if (meta.status === "running" && Date.now() - new Date(meta.startedAt).getTime() > staleMinutes * 60000) {
    return { status: "stale", startedAt: meta.startedAt };
  }
  return { status: meta.status, error: meta.error || null, startedAt: meta.startedAt };
}

/** Race a promise against an overall wall-clock budget (long Gemini calls must not run forever). */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)),
  ]);
}
