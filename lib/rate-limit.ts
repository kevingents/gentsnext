import { createHash } from "node:crypto";

/**
 * Lichte in-memory sliding-window rate-limit (per Vercel-functie-instance). Geen
 * dependency; bedoeld als frictie/backstop tegen brute-force & enumeratie op
 * core-endpoints. NB: serverless draait meerdere instances, dus dit is GEEN harde
 * globale limiet — voor een cross-instance hard cap is een KV/DB-backed teller de
 * vervolgstap. In combinatie met audit-logging (zie hieronder) maakt 't misbruik
 * wel zichtbaar én duurder.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfterSec: number; count: number } {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    buckets.set(key, arr);
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - arr[0])) / 1000), count: arr.length };
  }
  arr.push(now);
  buckets.set(key, arr);
  // Lichte GC: voorkom onbegrensde groei van de Map.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  }
  return { ok: true, retryAfterSec: 0, count: arr.length };
}

/** Korte, niet-omkeerbare vingerafdruk van een geheim (token/IP) voor log + sleutel.
 *  Zo loggen/sleutelen we nooit het geheim zelf. */
export function fingerprint(secret: string): string {
  return createHash("sha256").update(String(secret || "")).digest("hex").slice(0, 10);
}
