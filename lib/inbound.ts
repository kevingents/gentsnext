/**
 * Inbound goederenontvangst (F1 — scan-to-receive). Een zending (replenishment uit
 * het magazijn, leverancier of winkel→winkel) komt binnen als ASN: verwachte regels
 * + status (gepickt → onderweg → ontvangen). De winkel SCANT bij binnenkomst en boekt
 * pas DÁN voorraad bij — een channel:'inbound' +1-movement (ref `RCV-<id>`), idempotent
 * op (ref, channel, stockKey). Onderweg-voorraad telt NIET mee in `available`
 * (anti-fantoom). Gespiegeld op lib/inventory.ts.
 *
 * SRS-overdracht: de gebruiker koos "SRS hoogt de winkelvoorraad pas op bij ontvangst
 * (Receive)". De inbound-delta overbrugt het gat tot de SRS-baseline 'm overneemt;
 * markInboundReceiptPosted(ref) zet dan srs_posted_at (zoals de POS-mechaniek) zodat
 * 'ie bij de eerstvolgende sync uit de som valt → geen dubbeltelling. WANNEER precies
 * SRS de Receive verwerkt, valideren we tegen de echte SRS-flow vóór go-live; tot dan
 * blijft de delta staan (geen vanishing van net-gescande voorraad).
 */
import { getDb } from "@/db";
import { inboundShipments, inboundReceiptCounts } from "@/db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { recordMovements, markMovementsSrsPosted, availableBreakdown } from "@/lib/store-core";
import { stockAvailable } from "@/lib/stock";
import { buildSamplePlan, type SamplePlan } from "@/lib/inbound-sampling";
import { logDiscrepancies } from "@/lib/inbound-discrepancies";

type Shipment = typeof inboundShipments.$inferSelect;
type Count = typeof inboundReceiptCounts.$inferSelect;
export type ExpectedLine = { stockKey: string; sku: string; barcode: string; title: string; size: string; color: string; imageUrl: string; expectedQty: number };

const ACTIVE = ["picked", "in_transit", "receiving"] as const;

function withVariance(c: Count) {
  return { ...c, variance: c.scannedQty - c.expectedQty };
}
function refFor(shipmentId: string) {
  return `RCV-${shipmentId}`;
}

/** Gescande code (barcode of sku) → variant-metadata + tel-sleutel. Zelfde resolutie
 *  als de inventarisatie/kassa zodat de stockKey 1-op-1 overeenkomt. */
export async function resolveCode(code: string): Promise<Omit<ExpectedLine, "expectedQty"> | null> {
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

/** Verrijk een {sku, expected}-lijst (uit de replenishment-order) tot ASN-regels met
 *  variant-meta + stockKey (zodat scannen en verwacht dezelfde sleutel delen). */
export async function buildExpectedLines(skuExpected: { sku: string; expected: number }[]): Promise<ExpectedLine[]> {
  const list = (skuExpected || []).filter((s) => s && s.sku && Number(s.expected) > 0);
  if (!list.length) return [];
  const db = getDb();
  const skus = [...new Set(list.map((s) => String(s.sku)))];
  const rows = await db.execute<{ sku: string; barcode: string; title: string; size: string; color: string; img: string | null }>(sql`
    select v.sku, v.barcode, p.title, v.size, v.color,
      coalesce((select pi.url from product_images pi where pi.product_id = v.product_id order by pi.position asc limit 1), nullif(v.image_url, '')) img
    from product_variants v join products p on p.id = v.product_id
    where v.sku in (${sql.join(skus.map((s) => sql`${s}`), sql`, `)})`);
  const meta = new Map(rows.rows.map((r) => [r.sku, r]));
  const out: ExpectedLine[] = [];
  for (const { sku, expected } of list) {
    const m = meta.get(String(sku));
    const barcode = m?.barcode || "";
    out.push({
      stockKey: String(barcode || sku).toLowerCase(),
      sku: String(sku), barcode, title: m?.title || "", size: m?.size || "", color: m?.color || "", imageUrl: m?.img || "",
      expectedQty: Number(expected) || 0,
    });
  }
  return out;
}

/** Maak een zending klaar (de ASN). Levert óf kant-en-klare expectedLines, óf een
 *  skuExpected-lijst die we hier verrijken. Default status 'picked'. */
export async function createInboundShipment(input: {
  toStore: string; source?: string; sourceType?: string; fromLocation?: string; linkRef?: string; parts?: number;
  expectedLines?: ExpectedLine[]; skuExpected?: { sku: string; expected: number }[];
  status?: string; note?: string; createdBy?: string;
}): Promise<Shipment> {
  if (!input.toStore) throw new Error("toStore vereist");
  const expectedLines = Array.isArray(input.expectedLines) && input.expectedLines.length
    ? input.expectedLines
    : await buildExpectedLines(input.skuExpected || []);
  const status = ["picked", "in_transit", "receiving"].includes(String(input.status)) ? String(input.status) : "picked";
  const db = getDb();
  const [s] = await db.insert(inboundShipments).values({
    toStore: input.toStore,
    source: input.source || "magazijn",
    sourceType: ["transfer", "supplier", "interstore"].includes(String(input.sourceType)) ? String(input.sourceType) : "transfer",
    fromLocation: input.fromLocation || "",
    linkRef: input.linkRef || "",
    parts: Math.max(1, Number(input.parts) || 1),
    expectedLines,
    status,
    note: input.note || "",
    createdBy: input.createdBy || "",
    pickedAt: new Date(),
  }).returning();
  return s;
}

/**
 * Winkel→winkel-herverdeling (F4). Een bronwinkel stuurt voorraad naar een doelwinkel:
 * (1) de voorraad gaat ER AF bij de bron (channel:'transfer' −1, ref `XFER-OUT-<id>`) —
 * de stuks zijn fysiek weg/onderweg, dus niet meer beschikbaar bij de bron (anti-
 * dubbeltelling); (2) er ontstaat een interstore-zending die de doelwinkel via de
 * gewone scan-to-receive flow ontvangt (+1 bij ontvangst). Onderweg telt het bij geen
 * van beide mee. Idempotent op de refs.
 */
export async function createInterstoreTransfer(input: {
  fromStore: string; toStore: string; expectedLines?: ExpectedLine[]; skuExpected?: { sku: string; expected: number }[]; createdBy?: string; note?: string;
  shipMethod?: string; plannedRouteDate?: string; urgent?: boolean;
}): Promise<{ ok: boolean; error?: string; shipment?: Shipment; deducted?: { stockKey: string; delta: number }[] }> {
  const fromStore = String(input.fromStore || "").trim();
  const toStore = String(input.toStore || "").trim();
  if (!fromStore || !toStore) return { ok: false, error: "Bron- en doelwinkel vereist." };
  if (fromStore.toLowerCase() === toStore.toLowerCase()) return { ok: false, error: "Bron en doel zijn dezelfde winkel." };
  const lines = Array.isArray(input.expectedLines) && input.expectedLines.length
    ? input.expectedLines
    : await buildExpectedLines(input.skuExpected || []);
  if (!lines.length) return { ok: false, error: "Geen artikelen om te versturen." };

  // Weiger als de bronwinkel onvoldoende voorraad heeft: anders zou de afboeking de bron
  // NEGATIEF maken (en zou de doelwinkel fantoomvoorraad krijgen). We toetsen op SKU (de
  // SRS-baseline-index is op SKU gesleuteld, niet op barcode) tegen de FYSIEK beschikbare
  // voorraad = baseline + kassa-delta − webreservering, ZÓNDER de veiligheidsbuffer (die is
  // voor anti-oversell bij verkoop, niet voor een fysieke herverdeling waar de spullen er
  // al liggen). Bij een niet-geladen voorraad-index (blob/token-storing) slaan we de gate
  // over i.p.v. álles onterecht te weigeren.
  if (await stockAvailable().catch(() => false)) {
    const need = new Map<string, number>();
    for (const l of lines) {
      const key = String(l.sku || "").trim();
      if (!key) continue;
      need.set(key, (need.get(key) || 0) + (Number(l.expectedQty) || 0));
    }
    if (need.size) {
      const bd = await availableBreakdown(fromStore, [...need.keys()]);
      const physicalOf = (key: string) => {
        const b = bd.get(key);
        return b ? Math.max(0, b.baseline + b.posDelta - b.webReserved) : 0;
      };
      const short = [...need.entries()].filter(([key, qty]) => qty > physicalOf(key));
      if (short.length) {
        const detail = short
          .map(([key, qty]) => {
            const l = lines.find((x) => String(x.sku || "").trim() === key);
            const label = [l?.title, l?.size && `maat ${l.size}`].filter(Boolean).join(" ") || key;
            return `${label}: nodig ${qty}, beschikbaar ${physicalOf(key)}`;
          })
          .join("; ");
        return { ok: false, error: `Onvoldoende voorraad in ${fromStore} — ${detail}.` };
      }
    }
  }

  const db = getDb();
  const shipMethod = input.shipMethod === "route" || input.shipMethod === "dhl" ? input.shipMethod : "";
  const [ship] = await db.insert(inboundShipments).values({
    toStore, source: fromStore, sourceType: "interstore", fromLocation: fromStore,
    linkRef: "", parts: 1, expectedLines: lines, status: "in_transit",
    note: input.note || "", createdBy: input.createdBy || "", pickedAt: new Date(), inTransitAt: new Date(),
    shipMethod, plannedRouteDate: input.plannedRouteDate ? new Date(input.plannedRouteDate) : null, urgent: !!input.urgent,
  }).returning();
  await db.update(inboundShipments).set({ linkRef: `XFER-${ship.id.slice(0, 8).toUpperCase()}` }).where(eq(inboundShipments.id, ship.id));

  // Afboeken bij de bron (de stuks zijn weg/onderweg).
  const movLines = lines.map((l) => ({ barcode: l.barcode, sku: l.sku, name: l.title, color: l.color, size: l.size, qty: Number(l.expectedQty) || 0 }));
  const res = await recordMovements({
    location: fromStore, channel: "transfer", sign: -1, ref: `XFER-OUT-${ship.id}`,
    reason: `herverdeling → ${toStore}`, lines: movLines,
  });
  return { ok: true, shipment: { ...ship, linkRef: `XFER-${ship.id.slice(0, 8).toUpperCase()}` }, deducted: res.applied };
}

/** Markeer de bron-afboeking van een herverdeling als 'in SRS verwerkt'. */
export async function markTransferOutPosted(shipmentId: string): Promise<void> {
  await markMovementsSrsPosted(`XFER-OUT-${shipmentId}`, "transfer");
}

/** Status-overgang met de bijbehorende timestamp. */
export async function setShipmentStatus(shipmentId: string, status: string, by?: string): Promise<Shipment | null> {
  const allowed = ["picked", "in_transit", "receiving", "received", "closed", "cancelled"];
  if (!allowed.includes(status)) return null;
  const patch: Partial<Shipment> = { status };
  if (status === "in_transit") patch.inTransitAt = new Date();
  if (status === "received") { patch.receivedAt = new Date(); if (by) patch.receivedBy = by; }
  if (status === "closed") patch.closedAt = new Date();
  const db = getDb();
  const [s] = await db.update(inboundShipments).set(patch).where(eq(inboundShipments.id, shipmentId)).returning();
  return s || null;
}

/** Bevries het steekproefplan op de zending (idempotent — eenmaal berekend blijft 't
 *  staan zodat de medewerker-UI deterministisch is en de audit klopt). */
export async function prepareSamplePlan(shipmentId: string): Promise<Shipment | null> {
  const s = await getShipment(shipmentId);
  if (!s) return null;
  if (s.samplePlan) return s;
  const plan = await buildSamplePlan(s);
  const db = getDb();
  const [u] = await db.update(inboundShipments).set({ samplePlan: plan }).where(eq(inboundShipments.id, shipmentId)).returning();
  return u || s;
}

/** Winkel opent een zending om te ontvangen: → 'receiving' + bevries het steekproefplan. */
export async function startReceiving(shipmentId: string, _startedBy?: string): Promise<Shipment | null> {
  const db = getDb();
  await db.update(inboundShipments)
    .set({ status: "receiving" })
    .where(and(eq(inboundShipments.id, shipmentId), inArray(inboundShipments.status, ["picked", "in_transit"])));
  return prepareSamplePlan(shipmentId);
}

async function getShipment(id: string): Promise<Shipment | null> {
  const db = getDb();
  const [s] = await db.select().from(inboundShipments).where(eq(inboundShipments.id, id)).limit(1);
  return s || null;
}

/** Zending + scanresultaten (met variantie). */
export async function getInboundShipment(id: string): Promise<{ shipment: Shipment; counts: ReturnType<typeof withVariance>[] } | null> {
  const s = await getShipment(id);
  if (!s) return null;
  const db = getDb();
  const counts = await db.select().from(inboundReceiptCounts).where(eq(inboundReceiptCounts.shipmentId, id)).orderBy(desc(inboundReceiptCounts.lastScannedAt));
  return { shipment: s, counts: counts.map(withVariance) };
}

/** Lijst zendingen voor een winkel (overzicht 'openstaande orders + status'). */
export async function listInboundShipments(toStore: string, status?: string, limit = 50): Promise<Shipment[]> {
  const db = getDb();
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const cond = status
    ? and(eq(inboundShipments.toStore, toStore), eq(inboundShipments.status, status))
    : eq(inboundShipments.toStore, toStore);
  return db.select().from(inboundShipments).where(cond).orderBy(desc(inboundShipments.createdAt)).limit(lim);
}

/** Openstaande (nog te ontvangen) zendingen voor een winkel: gepickt/onderweg/bezig. */
export async function openInboundForStore(toStore: string): Promise<Shipment[]> {
  const db = getDb();
  return db.select().from(inboundShipments)
    .where(and(eq(inboundShipments.toStore, toStore), inArray(inboundShipments.status, [...ACTIVE])))
    .orderBy(desc(inboundShipments.createdAt));
}

/** Informatieve 'er komt nog aan'-teller per stockKey (NIET in available verwerkt):
 *  som van (verwacht − reeds gescand) over nog-niet-ontvangen zendingen. */
export async function inTransitQtyForStore(toStore: string, keys?: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const open = await openInboundForStore(toStore);
  if (!open.length) return out;
  const wanted = keys && keys.length ? new Set(keys.map((k) => k.toLowerCase())) : null;
  // reeds gescande aantallen per shipment ophalen om 'resterend onderweg' te tonen
  const db = getDb();
  const ids = open.map((s) => s.id);
  const counts = await db.select().from(inboundReceiptCounts).where(inArray(inboundReceiptCounts.shipmentId, ids));
  const scanned = new Map<string, number>(); // `${shipmentId}|${stockKey}` → scanned
  for (const c of counts) scanned.set(`${c.shipmentId}|${c.stockKey}`, c.scannedQty);
  for (const s of open) {
    for (const l of (s.expectedLines as ExpectedLine[]) || []) {
      const k = String(l.stockKey || "").toLowerCase();
      if (!k || (wanted && !wanted.has(k))) continue;
      const remaining = Math.max(0, (Number(l.expectedQty) || 0) - (scanned.get(`${s.id}|${k}`) || 0));
      if (remaining > 0) out.set(k, (out.get(k) || 0) + remaining);
    }
  }
  return out;
}

/** Scan een artikel bij ontvangst. Atomaire upsert (scanned += qty) zodat meerdere
 *  medewerkers tegelijk kunnen scannen. expectedQty komt uit de ASN (niet de baseline). */
export async function scanReceipt(input: { shipmentId: string; code: string; qty?: number; mode?: string }): Promise<{ ok: boolean; error?: string; count?: ReturnType<typeof withVariance> }> {
  const db = getDb();
  const s = await getShipment(input.shipmentId);
  if (!s) return { ok: false, error: "Zending niet gevonden." };
  if (!["picked", "in_transit", "receiving"].includes(s.status)) return { ok: false, error: "Zending is al ontvangen/afgesloten." };
  const meta = await resolveCode(input.code);
  if (!meta || !meta.stockKey) return { ok: false, error: `Onbekend artikel: "${input.code}".` };

  const setMode = input.mode === "set";
  const qty = setMode ? Math.max(0, Number(input.qty) || 0) : Math.max(1, Number(input.qty) || 1);
  // Verwacht aantal uit de ASN; onbekend in de ASN → 0 (onverwacht → wordt in F3 een afwijking).
  const asnLine = ((s.expectedLines as ExpectedLine[]) || []).find((l) => String(l.stockKey).toLowerCase() === meta.stockKey);
  const expected = asnLine ? Number(asnLine.expectedQty) || 0 : 0;

  // Eerste scan zet 'receiving' (als 'ie nog picked/in_transit was).
  if (s.status !== "receiving") await setShipmentStatus(s.id, "receiving");

  const [row] = await db.insert(inboundReceiptCounts).values({
    shipmentId: s.id, stockKey: meta.stockKey, sku: meta.sku, barcode: meta.barcode,
    title: meta.title, size: meta.size, color: meta.color, imageUrl: meta.imageUrl,
    scannedQty: qty, expectedQty: expected,
  }).onConflictDoUpdate({
    target: [inboundReceiptCounts.shipmentId, inboundReceiptCounts.stockKey],
    set: setMode
      ? { scannedQty: qty, lastScannedAt: new Date() }
      : { scannedQty: sql`${inboundReceiptCounts.scannedQty} + ${qty}`, lastScannedAt: new Date() },
  }).returning();
  return { ok: true, count: withVariance(row) };
}

const FLAG_CODES = ["DAMAGED", "WRONG_ITEM", "QUALITY", "MISLABELED"];

/** Markeer (een deel van) een gescande regel als beschadigd/verkeerd → die stuks
 *  worden NIET als verkoopbare voorraad geboekt (quarantaine) + leveren een afwijking.
 *  code '' = melding intrekken. qty default = het volledige gescande aantal. */
export async function flagReceiptLine(input: { shipmentId: string; stockKey: string; code: string; qty?: number }): Promise<{ ok: boolean; error?: string; count?: ReturnType<typeof withVariance> }> {
  const code = FLAG_CODES.includes(input.code) ? input.code : "";
  const db = getDb();
  const [c] = await db.select().from(inboundReceiptCounts)
    .where(and(eq(inboundReceiptCounts.shipmentId, input.shipmentId), eq(inboundReceiptCounts.stockKey, input.stockKey))).limit(1);
  if (!c) return { ok: false, error: "Regel niet gevonden." };
  const qty = code ? Math.max(1, Math.min(c.scannedQty, Number(input.qty) || c.scannedQty)) : 0;
  const [row] = await db.update(inboundReceiptCounts).set({ flagCode: code, flagQty: qty })
    .where(and(eq(inboundReceiptCounts.shipmentId, input.shipmentId), eq(inboundReceiptCounts.stockKey, input.stockKey))).returning();
  return { ok: true, count: withVariance(row) };
}

/** Een gescande regel verwijderen (per ongeluk gescand). */
export async function deleteReceiptCount(shipmentId: string, stockKey: string): Promise<{ ok: boolean }> {
  const db = getDb();
  await db.delete(inboundReceiptCounts).where(and(eq(inboundReceiptCounts.shipmentId, shipmentId), eq(inboundReceiptCounts.stockKey, stockKey)));
  return { ok: true };
}

/**
 * Sluit de ontvangst af → boek voorraad bij (PAS NU telt het mee). Alleen het
 * werkelijk GESCANDE aantal per regel wordt geboekt (channel:'inbound', sign:+1,
 * ref `RCV-<id>`), idempotent op (ref, channel, stockKey) → dubbel afsluiten/syncen
 * boekt nooit dubbel. Het missende stuk wordt simpelweg nooit toegevoegd → geen
 * fantoomvoorraad. Status → 'received'.
 */
export async function receiveShipment(shipmentId: string, receivedBy?: string): Promise<{ ok: boolean; error?: string; booked: { stockKey: string; delta: number }[]; lines: ReturnType<typeof withVariance>[]; alreadyReceived?: boolean; verdict?: "accepted" | "escalate" | "full"; need100?: boolean; sampleDiscrepancies?: number; discrepancies?: number; message?: string }> {
  const data = await getInboundShipment(shipmentId);
  if (!data) return { ok: false, error: "Zending niet gevonden.", booked: [], lines: [] };
  const { shipment, counts } = data;
  if (["received", "closed"].includes(shipment.status)) {
    return { ok: true, booked: [], lines: counts, alreadyReceived: true };
  }

  const book = async (lines: { barcode: string; sku: string; name: string; color: string; size: string; qty: number }[]) => {
    const real = lines.filter((l) => l.qty > 0);
    if (!real.length) return [];
    const res = await recordMovements({
      location: shipment.toStore, channel: "inbound", sign: 1, ref: refFor(shipment.id),
      reason: `ontvangst ${shipment.linkRef || shipment.source || ""}`.trim(), lines: real,
    });
    return res.applied;
  };

  const plan = shipment.samplePlan as SamplePlan | null;
  const asn = (shipment.expectedLines as ExpectedLine[]) || [];
  const countByKey = new Map(counts.map((c) => [c.stockKey, c]));
  // Alleen de GOEDE stuks boeken: gescand − gevlagd (beschadigd/verkeerd = quarantaine).
  const good = (c?: { scannedQty: number; flagQty?: number } | null) => Math.max(0, (c?.scannedQty ?? 0) - (c?.flagQty ?? 0));

  // STEEKPROEF: AQL-acceptatie vóór boeken.
  if (plan && plan.mode === "sample") {
    const sampled = new Set(plan.sampledStockKeys);
    let d = 0;
    for (const key of plan.sampledStockKeys) {
      const exp = asn.find((l) => l.stockKey === key)?.expectedQty ?? 0;
      const scanned = countByKey.get(key)?.scannedQty ?? 0;
      if (scanned !== exp) d++;
    }
    if (d >= plan.re) {
      // Afgekeurd → escaleer naar 100%: plan → full, nog NIET boeken.
      const fullPlan: SamplePlan = { ...plan, mode: "full", reason: `afgekeurd (${d} afwijkingen ≥ ${plan.re}) → tel de hele levering`, sampledStockKeys: asn.map((l) => l.stockKey) };
      await getDb().update(inboundShipments).set({ samplePlan: fullPlan }).where(eq(inboundShipments.id, shipmentId));
      return { ok: true, booked: [], lines: counts, verdict: "escalate", need100: true, sampleDiscrepancies: d, message: `Te veel afwijkingen in de steekproef (${d}). Tel nu de hele levering.` };
    }
    // Geaccepteerd → sampled = gescand, vertrouwd = verwacht, onverwacht = gescand.
    const asnKeys = new Set(asn.map((l) => l.stockKey));
    const bookLines = asn.map((l) => ({
      barcode: l.barcode, sku: l.sku, name: l.title, color: l.color, size: l.size,
      // Gesamplede regels: gescand − gevlagd. Vertrouwde regels: verwacht − gevlagd — een
      // schade-/verkeerd-melding op een vertrouwde regel mag niet als verkoopbaar geboekt.
      qty: sampled.has(l.stockKey)
        ? good(countByKey.get(l.stockKey))
        : Math.max(0, (Number(l.expectedQty) || 0) - (countByKey.get(l.stockKey)?.flagQty ?? 0)),
    }));
    for (const c of counts) if (!asnKeys.has(c.stockKey) && c.scannedQty > 0) bookLines.push({ barcode: c.barcode, sku: c.sku, name: c.title, color: c.color, size: c.size, qty: good(c) });
    const booked = await book(bookLines);
    await setShipmentStatus(shipment.id, "received", receivedBy);
    const disc = await logDiscrepancies(shipment, counts, plan).catch(() => ({ count: 0, codes: {} }));
    return { ok: true, booked, lines: counts, verdict: "accepted", discrepancies: disc.count };
  }

  // FULL (of geen plan): boek alleen de goede stuks (gescand − gevlagd).
  const booked = await book(counts.map((c) => ({ barcode: c.barcode, sku: c.sku, name: c.title, color: c.color, size: c.size, qty: good(c) })));
  await setShipmentStatus(shipment.id, "received", receivedBy);
  const disc = await logDiscrepancies(shipment, counts, plan).catch(() => ({ count: 0, codes: {} }));
  return { ok: true, booked, lines: counts, verdict: "full", discrepancies: disc.count };
}

/** Markeer de ontvangst-movements als 'in SRS verwerkt' (overdracht naar de baseline).
 *  Aan te roepen zodra SRS de Receive heeft geboekt — valideren tegen de echte
 *  SRS-flow vóór go-live. */
export async function markInboundReceiptPosted(shipmentId: string): Promise<void> {
  await markMovementsSrsPosted(refFor(shipmentId), "inbound");
}
