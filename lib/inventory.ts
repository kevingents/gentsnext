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

type ScopeSku = { sku?: string; barcode?: string; expected?: number; title?: string; size?: string; color?: string; imageUrl?: string };

/** Verrijk een {sku, expected}-lijst met variant-meta (barcode/title/size/color/image)
 *  → zodat de zeroing dezelfde stockKey (barcode||sku) krijgt als een scan. */
async function buildScopeSkus(skuExpected: { sku: string; expected: number }[]): Promise<ScopeSku[]> {
  const list = (skuExpected || []).filter((s) => s && s.sku);
  if (!list.length) return [];
  const db = getDb();
  const skus = [...new Set(list.map((s) => String(s.sku)))];
  const rows = await db.execute<{ sku: string; barcode: string; title: string; size: string; color: string; img: string | null }>(sql`
    select v.sku, v.barcode, p.title, v.size, v.color,
      coalesce((select pi.url from product_images pi where pi.product_id = v.product_id order by pi.position asc limit 1), nullif(v.image_url, '')) img
    from product_variants v join products p on p.id = v.product_id
    where v.sku in (${sql.join(skus.map((s) => sql`${s}`), sql`, `)})`);
  const meta = new Map(rows.rows.map((r) => [r.sku, r]));
  return list.map(({ sku, expected }) => {
    const m = meta.get(String(sku));
    return { sku: String(sku), barcode: m?.barcode || "", expected: Number(expected) || 0, title: m?.title || "", size: m?.size || "", color: m?.color || "", imageUrl: m?.img || "" };
  });
}

/** Supply-chain zet een telling klaar (status 'prepared') met scope + de verwachte
 *  SKU's op klaarzet-moment (voor de zeroing van niet-getelde artikelen). Levert
 *  óf een kant-en-klare scopeSkus, óf een skuExpected-lijst die we hier verrijken. */
export async function prepareInventorySession(input: { location: string; scope?: string; scopeValues?: unknown[]; scopeSkus?: ScopeSku[]; skuExpected?: { sku: string; expected: number }[]; type?: string; section?: string; note?: string; assignedBy?: string }) {
  const db = getDb();
  const scopeSkus = Array.isArray(input.scopeSkus) && input.scopeSkus.length
    ? input.scopeSkus
    : await buildScopeSkus(input.skuExpected || []);
  const [s] = await db.insert(inventorySessions).values({
    location: input.location,
    status: "prepared",
    type: input.type === "partial" || input.scope === "section" ? "partial" : "full",
    section: input.section || "",
    scope: input.scope || "",
    scopeValues: Array.isArray(input.scopeValues) ? input.scopeValues : [],
    scopeSkus,
    note: input.note || "",
    assignedBy: input.assignedBy || "",
  }).returning();
  return s;
}

/** Winkel start een klaargezette telling: prepared → open. */
export async function startPreparedSession(sessionId: string, startedBy?: string) {
  const db = getDb();
  const [s] = await db.update(inventorySessions)
    .set({ status: "open", startedBy: startedBy || "" })
    .where(and(eq(inventorySessions.id, sessionId), eq(inventorySessions.status, "prepared"))).returning();
  return s || null;
}

export async function scanInventory(input: { sessionId: string; code: string; qty?: number; mode?: string }): Promise<{ ok: boolean; error?: string; count?: ReturnType<typeof withVariance> }> {
  const db = getDb();
  const [session] = await db.select().from(inventorySessions).where(eq(inventorySessions.id, input.sessionId)).limit(1);
  if (!session) return { ok: false, error: "Sessie niet gevonden." };
  if (session.status !== "open") return { ok: false, error: "Telsessie is al afgesloten." };
  const meta = await resolveCode(input.code);
  if (!meta || !meta.stockKey) return { ok: false, error: `Onbekend artikel: "${input.code}".` };
  // mode 'set' = exact aantal invullen; anders +1 (rap scannen).
  const setMode = input.mode === "set";
  const qty = setMode ? Math.max(0, Number(input.qty) || 0) : Math.max(1, Number(input.qty) || 1);

  // Verwachte voorraad bij de eerste observatie = SRS-baseline + kassa-delta (fysiek).
  const breakdown = await availableBreakdown(session.location, [meta.stockKey]);
  const b = breakdown.get(meta.stockKey);
  const expected = b ? Math.max(0, b.baseline + b.posDelta) : 0;

  // ATOMAIRE upsert: bij +1-scannen telt de DB zelf op (scanned_qty + qty) zodat
  // MEERDERE tellers tegelijk hetzelfde artikel kunnen scannen zonder lost updates.
  // expected_qty wordt alleen bij de eerste insert gezet (ON CONFLICT laat 'm staan).
  const [row] = await db.insert(inventoryCounts).values({
    sessionId: session.id, stockKey: meta.stockKey, sku: meta.sku, barcode: meta.barcode,
    title: meta.title, size: meta.size, color: meta.color, imageUrl: meta.imageUrl,
    scannedQty: qty, expectedQty: expected,
  }).onConflictDoUpdate({
    target: [inventoryCounts.sessionId, inventoryCounts.stockKey],
    set: setMode
      ? { scannedQty: qty, lastScannedAt: new Date() }
      : { scannedQty: sql`${inventoryCounts.scannedQty} + ${qty}`, lastScannedAt: new Date() },
  }).returning();
  return { ok: true, count: withVariance(row) };
}

/** Een geteld artikel uit de sessie verwijderen (per ongeluk gescand / corrigeren). */
export async function deleteInventoryCount(input: { sessionId: string; stockKey: string }): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const [session] = await db.select().from(inventorySessions).where(eq(inventorySessions.id, input.sessionId)).limit(1);
  if (!session) return { ok: false, error: "Sessie niet gevonden." };
  if (session.status !== "open") return { ok: false, error: "Telsessie is al afgesloten." };
  await db.delete(inventoryCounts).where(and(eq(inventoryCounts.sessionId, input.sessionId), eq(inventoryCounts.stockKey, input.stockKey)));
  return { ok: true };
}

export async function getInventorySession(sessionId: string) {
  const db = getDb();
  const [session] = await db.select().from(inventorySessions).where(eq(inventorySessions.id, sessionId)).limit(1);
  if (!session) return null;
  const counts = await db.select().from(inventoryCounts).where(eq(inventoryCounts.sessionId, sessionId)).orderBy(desc(inventoryCounts.lastScannedAt));
  return { session, counts: counts.map(withVariance) };
}

export async function listInventorySessions(location: string, status?: string, limit = 30) {
  const db = getDb();
  const cond = status
    ? and(eq(inventorySessions.location, location), eq(inventorySessions.status, status))
    : eq(inventorySessions.location, location);
  return db.select().from(inventorySessions).where(cond).orderBy(desc(inventorySessions.createdAt)).limit(limit);
}

/** Voor supply-chain: afgeronde tellingen (alle winkels) die wachten op goedkeuring,
 *  met een korte variantie-samenvatting per sessie. */
export async function listSessionsForReview(limit = 50) {
  const db = getDb();
  const sessions = await db.select().from(inventorySessions).where(eq(inventorySessions.status, "completed")).orderBy(desc(inventorySessions.completedAt)).limit(limit);
  const out = [];
  for (const s of sessions) {
    const counts = (await db.select().from(inventoryCounts).where(eq(inventoryCounts.sessionId, s.id))).map(withVariance);
    out.push({
      session: s,
      items: counts.length,
      surplus: counts.filter((c) => c.variance > 0).length,
      shortage: counts.filter((c) => c.variance < 0).length,
      totalVariance: counts.reduce((n, c) => n + c.variance, 0),
    });
  }
  return out;
}

export async function completeInventorySession(sessionId: string, completedBy?: string) {
  const db = getDb();
  const [session] = await db.select().from(inventorySessions).where(eq(inventorySessions.id, sessionId)).limit(1);
  if (!session) {
    return { session: null, summary: { items: 0, totalScanned: 0, totalVariance: 0, surplus: 0, shortage: 0 }, counts: [] };
  }

  // ZEROING: alleen voor een klaargezette scope (all/group/articles). Elke scope-SKU
  // die NIET gescand is → als geteld 0 toevoegen (variantie −verwacht = ontbreekt),
  // zodat supply-chain het verschil ziet. (Sectie/vrije telling = geen scopeSkus.)
  const scopeSkus = (Array.isArray(session.scopeSkus) ? session.scopeSkus : []) as ScopeSku[];
  if (session.status === "open" && scopeSkus.length) {
    const existing = await db.select({ stockKey: inventoryCounts.stockKey }).from(inventoryCounts).where(eq(inventoryCounts.sessionId, sessionId));
    const have = new Set(existing.map((c) => c.stockKey));
    const toInsert = [];
    for (const sk of scopeSkus) {
      const key = String(sk.barcode || sk.sku || "").toLowerCase();
      if (!key || have.has(key)) continue;
      toInsert.push({
        sessionId, stockKey: key, sku: sk.sku || "", barcode: sk.barcode || "",
        title: sk.title || "", size: sk.size || "", color: sk.color || "", imageUrl: sk.imageUrl || "",
        scannedQty: 0, expectedQty: Number(sk.expected) || 0,
      });
    }
    if (toInsert.length) await db.insert(inventoryCounts).values(toInsert);
  }

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
  return { session: s || session, summary, counts };
}

/** Varianties als voorraadcorrectie boeken (core-movement, channel 'correction').
 *  Idempotent: ref 'INV-<sessie>' + de unieke (ref,channel,stockKey)-index. */
export async function applyInventoryVariances(sessionId: string, approvedBy?: string) {
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

  const [s] = await db.update(inventorySessions).set({ status: "applied", appliedAt: new Date(), approvedBy: approvedBy || "" }).where(eq(inventorySessions.id, sessionId)).returning();
  return { ok: true, applied: surplus.length + shortage.length, session: s };
}
