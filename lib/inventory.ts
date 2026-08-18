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
import { heldQtyByStockKey } from "@/lib/reservations";
import { displayQtyByStockKey } from "@/lib/display";

type Count = typeof inventoryCounts.$inferSelect;
type ScanMeta = { sku: string; barcode: string; title: string; size: string; color: string; imageUrl: string; stockKey: string };

function withVariance(c: Count) {
  return { ...c, variance: c.scannedQty - c.expectedQty };
}

/** Verrijk tel-regels met het apart-gehouden (gereserveerde) aantal in deze winkel,
 *  zodat de teller/supply-chain ziet welke stuks apart liggen en meegeteld moeten. */
async function enrichHeld<T extends { stockKey: string }>(location: string, counts: T[]): Promise<(T & { heldQty: number; displayQty: number })[]> {
  if (!counts.length) return [];
  const keys = counts.map((c) => c.stockKey);
  const [held, display] = await Promise.all([
    heldQtyByStockKey(location, keys).catch(() => new Map<string, number>()),
    displayQtyByStockKey(location, keys).catch(() => new Map<string, number>()),
  ]);
  return counts.map((c) => {
    const k = String(c.stockKey).toLowerCase();
    return { ...c, heldQty: held.get(k) || 0, displayQty: display.get(k) || 0 };
  });
}

/** Gescande code (barcode of sku) → variant-metadata + tel-sleutel. */
async function resolveCode(code: string): Promise<ScanMeta | null> {
  const c = String(code || "").trim();
  if (!c) return null;
  const db = getDb();
  // Hoofdletterongevoelig en spatie-tolerant matchen: een handscanner levert soms een
  // afwijkende schrijfwijze, en artikelnummers in de catalogus zijn niet uniform.
  // Barcode gaat vóór sku, zodat een code die bij het ene artikel de barcode en bij
  // het andere de sku is niet willekeurig uitpakt (limit 1 zonder order was arbitrair).
  const rows = await db.execute<{ sku: string; barcode: string; title: string; size: string; color: string; img: string | null }>(sql`
    select v.sku, v.barcode, p.title, v.size, v.color,
      coalesce((select pi.url from product_images pi where pi.product_id = v.product_id order by pi.position asc limit 1), nullif(v.image_url, '')) img
    from product_variants v join products p on p.id = v.product_id
    where lower(trim(v.barcode)) = lower(${c}) or lower(trim(v.sku)) = lower(${c})
    order by (lower(trim(v.barcode)) = lower(${c})) desc, v.id asc
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
async function buildScopeSkus(skuExpected: { sku: string; expected: number }[], groupFilter?: string[]): Promise<ScopeSku[]> {
  const list = (skuExpected || []).filter((s) => s && s.sku);
  if (!list.length) return [];
  const db = getDb();
  const skus = [...new Set(list.map((s) => String(s.sku)))];
  const rows = await db.execute<{ sku: string; barcode: string; title: string; size: string; color: string; img: string | null; hoofdgroep: string | null }>(sql`
    select v.sku, v.barcode, p.title, v.size, v.color,
      coalesce((select pi.url from product_images pi where pi.product_id = v.product_id order by pi.position asc limit 1), nullif(v.image_url, '')) img,
      (p.attributes ->> 'hoofdgroep_omschrijving') as hoofdgroep
    from product_variants v join products p on p.id = v.product_id
    where v.sku in (${sql.join(skus.map((s) => sql`${s}`), sql`, `)})`);
  const meta = new Map(rows.rows.map((r) => [r.sku, r]));
  // Groep-scope: filter op hoofdgroep (NULL/onbekende groep valt buiten een groep-telling).
  const groups = groupFilter && groupFilter.length ? new Set(groupFilter.map((g) => String(g).trim().toLowerCase())) : null;
  const out: ScopeSku[] = [];
  for (const { sku, expected } of list) {
    const m = meta.get(String(sku));
    if (groups && !(m && groups.has(String(m.hoofdgroep || "").trim().toLowerCase()))) continue;
    out.push({ sku: String(sku), barcode: m?.barcode || "", expected: Number(expected) || 0, title: m?.title || "", size: m?.size || "", color: m?.color || "", imageUrl: m?.img || "" });
  }
  return out;
}

/** Supply-chain zet een telling klaar (status 'prepared') met scope + de verwachte
 *  SKU's op klaarzet-moment (voor de zeroing van niet-getelde artikelen). Levert
 *  óf een kant-en-klare scopeSkus, óf een skuExpected-lijst die we hier verrijken. */
export async function prepareInventorySession(input: { location: string; scope?: string; scopeValues?: unknown[]; scopeSkus?: ScopeSku[]; skuExpected?: { sku: string; expected: number }[]; type?: string; section?: string; note?: string; assignedBy?: string }) {
  const db = getDb();
  const groupFilter = input.scope === "group" && Array.isArray(input.scopeValues) ? input.scopeValues.map(String) : undefined;
  const scopeSkus = Array.isArray(input.scopeSkus) && input.scopeSkus.length
    ? input.scopeSkus
    : await buildScopeSkus(input.skuExpected || [], groupFilter);
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

/** Productgroepen (hoofdgroep_omschrijving) — voor de groep-scope-keuze bij het
 *  klaarzetten van een telling. */
export async function listProductGroups(): Promise<string[]> {
  const db = getDb();
  const rows = await db.execute<{ g: string }>(sql`
    select distinct (attributes ->> 'hoofdgroep_omschrijving') as g
    from products
    where (attributes ->> 'hoofdgroep_omschrijving') is not null and (attributes ->> 'hoofdgroep_omschrijving') <> ''
    order by g`);
  return rows.rows.map((r) => r.g).filter(Boolean);
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
  // Op SKU zoeken: de VOORRAADBRON (srs_stock) kent alleen de SRS-sku;
  // `product_variants.barcode` (leveranciers-EAN) komt daar niet in voor, dus een
  // barcode-query gaf structureel "systeem 0". Sinds stockKey óók sku-eerst is
  // (lib/store-core) lopen de lees- en schrijfsleutel weer gelijk.
  const voorraadSleutel = String(meta.sku || meta.barcode || "").trim();
  const breakdown = await availableBreakdown(session.location, [voorraadSleutel]);
  const b = breakdown.get(voorraadSleutel);
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
  return { session, counts: await enrichHeld(session.location, counts.map(withVariance)) };
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

/** HISTORIE: álle tellingen over alle winkels (Rick, 5 aug: "historisch opslaan
 *  zodat altijd kan worden teruggezocht welke artikelen zijn gescand"). De
 *  review-lijst toont enkel wat nog goedgekeurd moet worden — na goedkeuring
 *  verdween een telling uit beeld terwijl de data gewoon bewaard bleef. Filters:
 *  winkel, status, type. Per sessie een variantie-samenvatting, zodat het
 *  overzicht zonder detail-call bruikbaar is. */
export async function listInventoryHistory(input: { location?: string; status?: string; type?: string; limit?: number } = {}) {
  const db = getDb();
  const lim = Math.max(1, Math.min(200, Number(input.limit) || 60));
  const filters = [];
  if (input.location) filters.push(eq(inventorySessions.location, input.location));
  if (input.status) filters.push(eq(inventorySessions.status, input.status));
  if (input.type) filters.push(eq(inventorySessions.type, input.type));
  const rows = await db
    .select().from(inventorySessions)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(inventorySessions.createdAt))
    .limit(lim);
  if (!rows.length) return [];

  /* Samenvatting per sessie in ÉÉN query (niet per sessie een losse call zoals
     listSessionsForReview: bij 60 sessies zijn dat 60 rondjes naar Neon). */
  const ids = rows.map((r) => r.id);
  const agg = await db.execute<{ session_id: string; items: number; scanned: number; surplus: number; shortage: number; variance: number }>(sql`
    select session_id,
           count(*)::int items,
           coalesce(sum(scanned_qty), 0)::int scanned,
           count(*) filter (where scanned_qty > expected_qty)::int surplus,
           count(*) filter (where scanned_qty < expected_qty)::int shortage,
           coalesce(sum(scanned_qty - expected_qty), 0)::int variance
    from inventory_counts
    where session_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
    group by session_id`);
  const bySession = new Map(agg.rows.map((r) => [String(r.session_id), r]));
  return rows.map((s) => {
    const a = bySession.get(s.id);
    return {
      session: s,
      items: Number(a?.items) || 0,
      totalScanned: Number(a?.scanned) || 0,
      surplus: Number(a?.surplus) || 0,
      shortage: Number(a?.shortage) || 0,
      totalVariance: Number(a?.variance) || 0,
    };
  });
}

/** ZOEKEN over alle tellingen op artikelnummer / artikel-ID / barcode / titel
 *  (Rick: "was dit artikel aanwezig tijdens de inventarisatie?"). Geeft per
 *  treffer de sessie erbij: winkel, datum, type — zodat direct zichtbaar is
 *  hoeveel stuks wanneer geteld zijn. Nieuwste telling eerst. */
export async function searchInventoryCounts(input: { q: string; location?: string; limit?: number }) {
  const q = String(input.q || "").trim();
  if (q.length < 2) return [];
  const db = getDb();
  const lim = Math.max(1, Math.min(200, Number(input.limit) || 50));
  const like = `%${q.toLowerCase()}%`;
  const rows = await db.execute<{
    stock_key: string; sku: string; barcode: string; title: string; size: string; color: string;
    scanned_qty: number; expected_qty: number; last_scanned_at: string;
    session_id: string; location: string; type: string; section: string; status: string; created_at: string; completed_at: string | null;
  }>(sql`
    select c.stock_key, c.sku, c.barcode, c.title, c.size, c.color,
           c.scanned_qty, c.expected_qty, c.last_scanned_at,
           s.id session_id, s.location, s.type, s.section, s.status, s.created_at, s.completed_at
    from inventory_counts c
    join inventory_sessions s on s.id = c.session_id
    where (lower(c.sku) like ${like} or lower(c.barcode) like ${like}
           or lower(c.stock_key) like ${like} or lower(c.title) like ${like})
      ${input.location ? sql`and s.location = ${input.location}` : sql``}
    order by coalesce(s.completed_at, s.created_at) desc
    limit ${lim}`);
  return rows.rows.map((r) => ({
    sku: r.sku, barcode: r.barcode, stockKey: r.stock_key,
    title: r.title, size: r.size, color: r.color,
    scannedQty: Number(r.scanned_qty) || 0,
    expectedQty: Number(r.expected_qty) || 0,
    variance: (Number(r.scanned_qty) || 0) - (Number(r.expected_qty) || 0),
    lastScannedAt: r.last_scanned_at,
    session: {
      id: r.session_id, location: r.location, type: r.type, section: r.section,
      status: r.status, createdAt: r.created_at, completedAt: r.completed_at,
    },
  }));
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
    // Apart-gehouden (gereserveerde) stuks per SKU: die liggen fysiek apart en mogen
    // NIET als 0 weggeboekt worden → de zeroing-vloer is het gereserveerde aantal.
    const scopeKeys = scopeSkus.map((sk) => String(sk.barcode || sk.sku || "").toLowerCase()).filter(Boolean);
    // Bekend-aanwezig = gereserveerd (hold) + op de paspop → die liggen er fysiek,
    // dus de zeroing zet ze op dat aantal i.p.v. 0 (niet wegboeken).
    const [held, display] = await Promise.all([
      heldQtyByStockKey(session.location, scopeKeys).catch(() => new Map<string, number>()),
      displayQtyByStockKey(session.location, scopeKeys).catch(() => new Map<string, number>()),
    ]);
    const toInsert = [];
    for (const sk of scopeSkus) {
      const key = String(sk.barcode || sk.sku || "").toLowerCase();
      if (!key || have.has(key)) continue;
      toInsert.push({
        sessionId, stockKey: key, sku: sk.sku || "", barcode: sk.barcode || "",
        title: sk.title || "", size: sk.size || "", color: sk.color || "", imageUrl: sk.imageUrl || "",
        scannedQty: (held.get(key) || 0) + (display.get(key) || 0), expectedQty: Number(sk.expected) || 0,
      });
    }
    if (toInsert.length) await db.insert(inventoryCounts).values(toInsert);
  }

  const [s] = await db.update(inventorySessions)
    .set({ status: "completed", completedAt: new Date(), completedBy: completedBy || "" })
    .where(and(eq(inventorySessions.id, sessionId), eq(inventorySessions.status, "open"))).returning();
  const counts = await enrichHeld(session.location, (await db.select().from(inventoryCounts).where(eq(inventoryCounts.sessionId, sessionId))).map(withVariance));
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
