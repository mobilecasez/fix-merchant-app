/**
 * Small AES-256-GCM helper for encrypting third-party API secrets at rest (e.g. Google Ads
 * credentials). The key is derived from an app env secret so no new key material is required —
 * set APP_ENCRYPTION_KEY for a dedicated key, otherwise it falls back to SHOPIFY_API_SECRET.
 * Format: "v1:<iv b64>:<tag b64>:<ciphertext b64>".
 */
import crypto from "node:crypto";

const KEY_SOURCE =
  process.env.APP_ENCRYPTION_KEY ||
  process.env.SHOPIFY_API_SECRET ||
  process.env.SESSION_SECRET ||
  "shopflix-ai-default-key";
const KEY = crypto.createHash("sha256").update(KEY_SOURCE).digest(); // 32 bytes

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(blob: string | null | undefined): string {
  if (!blob) return "";
  try {
    const parts = String(blob).split(":");
    if (parts.length !== 4 || parts[0] !== "v1") return "";
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const data = Buffer.from(parts[3], "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
