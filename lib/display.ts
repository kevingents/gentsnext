import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { displayItems } from "@/db/schema";

/**
 * Paspop / etalage — niet-blokkerende display-markering. Een stuk "op de paspop"
 * blijft gewoon verkoopbaar (we raken availability NIET aan); dit is puur
 * zichtbaarheid + meetellen bij inventarisatie. Eén rij per (winkel, stockKey).
 */

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();
export type DisplayLine = { stockKey?: string; sku?: string; barcode?: string; title?: string; size?: string; color?: string; imageUrl?: string };

export async function markDisplay(input: { location: string; line: DisplayLine; qty?: number; note?: string; createdBy?: string }) {
  const db = getDb();
  const location = String(input.location || "").trim();
  const l = input.line || {};
  const stockKey = lower(l.barcode || l.stockKey || l.sku);
  if (!location || !stockKey) return { ok: false as const, error: "Winkel + artikel vereist." };
  const qty = Math.max(1, Math.round(Number(input.qty) || 1));
  const [row] = await db.insert(displayItems).values({
    location, stockKey, sku: l.sku || "", barcode: l.barcode || "", title: l.title || "", size: l.size || "", color: l.color || "", imageUrl: l.imageUrl || "",
    qty, note: input.note || "", createdBy: input.createdBy || "",
  }).onConflictDoUpdate({
    target: [displayItems.location, displayItems.stockKey],
    set: { qty: sql`${displayItems.qty} + ${qty}`, note: input.note ? input.note : sql`${displayItems.note}`, updatedAt: new Date() },
  }).returning();
  return { ok: true as const, item: row };
}

/** Haal (een deel) van de paspop: qty weglaten = alles weg. */
export async function unmarkDisplay(input: { location: string; stockKey: string; qty?: number }) {
  const db = getDb();
  const location = String(input.location || "").trim();
  const stockKey = lower(input.stockKey);
  if (!location || !stockKey) return { ok: false as const, error: "Winkel + artikel vereist." };
  const [cur] = await db.select().from(displayItems).where(and(eq(displayItems.location, location), eq(displayItems.stockKey, stockKey))).limit(1);
  if (!cur) return { ok: true as const, removed: true };
  const dec = input.qty ? Math.max(1, Math.round(Number(input.qty))) : null;
  const next = dec == null ? 0 : Math.max(0, cur.qty - dec);
  if (next <= 0) { await db.delete(displayItems).where(eq(displayItems.id, cur.id)); return { ok: true as const, removed: true }; }
  await db.update(displayItems).set({ qty: next, updatedAt: new Date() }).where(eq(displayItems.id, cur.id));
  return { ok: true as const, qty: next };
}

export async function listDisplay(location: string) {
  const db = getDb();
  return db.select().from(displayItems).where(eq(displayItems.location, String(location || "").trim())).orderBy(desc(displayItems.updatedAt));
}

export async function listAllDisplay(limit = 500) {
  const db = getDb();
  return db.select().from(displayItems).orderBy(desc(displayItems.updatedAt)).limit(limit);
}

/** Verkoop aan de kassa → haal verkochte stuks automatisch van de paspop. Alleen
 *  bestaande markeringen worden verlaagd (de rest is een no-op). Non-fataal bedoeld. */
export async function applySale(location: string, lines: { sku?: string; barcode?: string; stockKey?: string; qty?: number }[]) {
  const db = getDb();
  const loc = String(location || "").trim();
  if (!loc || !Array.isArray(lines) || !lines.length) return { adjusted: 0 };
  const byKey = new Map<string, number>();
  for (const l of lines) {
    const key = lower(l?.barcode || l?.stockKey || l?.sku);
    const qty = Math.abs(Math.round(Number(l?.qty) || 0));
    if (!key || !qty) continue;
    byKey.set(key, (byKey.get(key) || 0) + qty);
  }
  if (!byKey.size) return { adjusted: 0 };
  const rows = await db.select().from(displayItems).where(and(eq(displayItems.location, loc), inArray(displayItems.stockKey, [...byKey.keys()])));
  let adjusted = 0;
  for (const r of rows) {
    const dec = byKey.get(r.stockKey) || 0;
    if (!dec) continue;
    const next = Math.max(0, r.qty - dec);
    if (next <= 0) await db.delete(displayItems).where(eq(displayItems.id, r.id));
    else await db.update(displayItems).set({ qty: next, updatedAt: new Date() }).where(eq(displayItems.id, r.id));
    adjusted++;
  }
  return { adjusted };
}

/** Aantal "op de paspop" per stockKey in een winkel — voor de inventarisatie-vloer. */
export async function displayQtyByStockKey(location: string, keys?: string[]): Promise<Map<string, number>> {
  const db = getDb();
  const loc = String(location || "").trim();
  const out = new Map<string, number>();
  if (!loc) return out;
  const clean = keys && keys.length ? [...new Set(keys.map(lower).filter(Boolean))] : null;
  if (clean && !clean.length) return out;
  const rows = clean
    ? await db.select().from(displayItems).where(and(eq(displayItems.location, loc), inArray(displayItems.stockKey, clean)))
    : await db.select().from(displayItems).where(eq(displayItems.location, loc));
  for (const r of rows) out.set(r.stockKey, Math.max(0, Number(r.qty) || 0));
  return out;
}
