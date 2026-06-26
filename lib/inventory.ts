/**
 * Inventarisatie (telsessie) op de handscanner. Scan artikelen → tel per artikel →
 * zet af tegen de systeemvoorraad (SRS-baseline + kassa-delta) → variantie →
 * optioneel als voorraadcorrectie (core-movement, channel 'correction') geboekt.
 * Deelinventarisatie = type 'partial' + een section-label.
 */
import { getDb } from "@/db";
import { inventorySessions, inventoryCounts } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { availableBreakdown, recordMovements } from "@/lib/store-core";

type Count = typeof inventoryCounts.$inferSelect;
type ScanMeta = { sku: string; barcode: string; title: string; size: string; color: string; imageUrl: string; stockKey: string };

function withVariance(c: Count) {
  return { ...c, variance: c.scannedQty - c.expectedQty };
}

/** Gescande code (barcode of sku) → variant-metadata + tel-sleutel. */
async function resolveCode(code: string): Promise<ScanMeta | null> {
  const c = String(code || "").trim();
  if (!c) return null;
  const db = getDb();
  const rows = await db.execute<{ sku: string; barcode: string; title: string; size: string; color: string; img: string | null }>(sql`
    select v.sku, v.barcode, p.title, v.size, v.color,
      coalesce((select pi.url from product_images pi where pi.product_id = v.product_id order by pi.position asc limit 1), nullif(v.image_url, '')) img
    from product_variants v join products p on p.id = v.product_id
    where v.barcode = ${c} or v.sku = ${c}
    limit 1`);
  const r = rows.rows[0];
  if (!r) return null;
  const stockKey = String(r.barcode || r.sku || "").toLowerCase();
  return { sku: r.sku || "", barcode: r.barcode || "", title: r.title || "", size: r.size || "", color: r.color || "", imageUrl: r.img || "", stockKey };
}

export async function startInventorySession(input: { location: string; type?: string; section?: string; note?: string; startedBy?: string }) {
  const db = getDb();
  const [s] = await db.insert(inventorySessions).values({
    location: input.location,
    type: input.type === "partial" ? "partial" : "full",
    section: input.section || "",
    note: input.note || "",
    startedBy: input.startedBy || "",
  }).returning();
  return s;
}

export async function scanInventory(input: { sessionId: string; code: string; qty?: number }): Promise<{ ok: boolean; error?: string; count?: ReturnType<typeof withVariance> }> {
  const db = getDb();
  const [session] = await db.select().from(inventorySessions).where(eq(inventorySessions.id, input.sessionId)).limit(1);
  if (!session) return { ok: false, error: "Sessie niet gevonden." };
  if (session.status !== "open") return { ok: false, error: "Telsessie is al afgesloten." };
  const meta = await resolveCode(input.code);
  if (!meta || !meta.stockKey) return { ok: false, error: `Onbekend artikel: "${input.code}".` };
  const qty = Math.max(1, Number(input.qty) || 1);

  const [existing] = await db.select().from(inventoryCounts)
    .where(and(eq(inventoryCounts.sessionId, session.id), eq(inventoryCounts.stockKey, meta.stockKey))).limit(1);
  if (existing) {
    const [upd] = await db.update(inventoryCounts)
      .set({ scannedQty: existing.scannedQty + qty, lastScannedAt: new Date() })
      .where(eq(inventoryCounts.id, existing.id)).returning();
    return { ok: true, count: withVariance(upd) };
  }

  // Verwachte voorraad bij de eerste scan = SRS-baseline + kassa-delta (fysiek).
  const breakdown = await availableBreakdown(session.location, [meta.stockKey]);
  const b = breakdown.get(meta.stockKey);
  const expected = b ? Math.max(0, b.baseline + b.posDelta) : 0;
  const [ins] = await db.insert(inventoryCounts).values({
    sessionId: session.id, stockKey: meta.stockKey, sku: meta.sku, barcode: meta.barcode,
    title: meta.title, size: meta.size, color: meta.color, imageUrl: meta.imageUrl,
    scannedQty: qty, expectedQty: expected,
  }).returning();
  return { ok: true, count: withVariance(ins) };
}

export async function getInventorySession(sessionId: string) {
  const db = getDb();
  const [session] = await db.select().from(inventorySessions).where(eq(inventorySessions.id, sessionId)).limit(1);
  if (!session) return null;
  const counts = await db.select().from(inventoryCounts).where(eq(inventoryCounts.sessionId, sessionId)).orderBy(desc(inventoryCounts.lastScannedAt));
  return { session, counts: counts.map(withVariance) };
}

export async function listInventorySessions(location: string, limit = 20) {
  const db = getDb();
  return db.select().from(inventorySessions).where(eq(inventorySessions.location, location)).orderBy(desc(inventorySessions.createdAt)).limit(limit);
}

export async function completeInventorySession(sessionId: string, completedBy?: string) {
  const db = getDb();
  const [s] = await db.update(inventorySessions)
    .set({ status: "completed", completedAt: new Date(), completedBy: completedBy || "" })
    .where(and(eq(inventorySessions.id, sessionId), eq(inventorySessions.status, "open"))).returning();
  const counts = (await db.select().from(inventoryCounts).where(eq(inventoryCounts.sessionId, sessionId))).map(withVariance);
  const summary = {
    items: counts.length,
    totalScanned: counts.reduce((n, c) => n + c.scannedQty, 0),
    totalVariance: counts.reduce((n, c) => n + c.variance, 0),
    surplus: counts.filter((c) => c.variance > 0).length,
    shortage: counts.filter((c) => c.variance < 0).length,
  };
  return { session: s || null, summary, counts };
}

/** Varianties als voorraadcorrectie boeken (core-movement, channel 'correction').
 *  Idempotent: ref 'INV-<sessie>' + de unieke (ref,channel,stockKey)-index. */
export async function applyInventoryVariances(sessionId: string) {
  const db = getDb();
  const [session] = await db.select().from(inventorySessions).where(eq(inventorySessions.id, sessionId)).limit(1);
  if (!session) return { ok: false, error: "Sessie niet gevonden." };
  if (session.status === "applied") return { ok: false, error: "Varianties zijn al verwerkt." };

  const counts = await db.select().from(inventoryCounts).where(eq(inventoryCounts.sessionId, sessionId));
  const ref = `INV-${session.id}`;
  const reason = `inventarisatie ${session.section || session.type}`.trim();
  const surplus = counts.filter((c) => c.scannedQty - c.expectedQty > 0);
  const shortage = counts.filter((c) => c.scannedQty - c.expectedQty < 0);

  if (surplus.length) {
    await recordMovements({ location: session.location, channel: "correction", reason, ref, sign: 1,
      lines: surplus.map((c) => ({ sku: c.sku || c.stockKey, barcode: c.barcode, qty: c.scannedQty - c.expectedQty })) });
  }
  if (shortage.length) {
    await recordMovements({ location: session.location, channel: "correction", reason, ref, sign: -1,
      lines: shortage.map((c) => ({ sku: c.sku || c.stockKey, barcode: c.barcode, qty: c.expectedQty - c.scannedQty })) });
  }

  const [s] = await db.update(inventorySessions).set({ status: "applied", appliedAt: new Date() }).where(eq(inventorySessions.id, sessionId)).returning();
  return { ok: true, applied: surplus.length + shortage.length, session: s };
}
