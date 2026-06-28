/**
 * Afwijkingen bij goederenontvangst (F3). Bij het afsluiten van een ontvangst loggen
 * we de regels die niet klopten (SHORT/OVER/NOT_ORDERED uit de telling; DAMAGED e.d.
 * via expliciete markering later) → tegenhanger van logMisses (niet-leverbaar). Dat
 * voedt (1) de supply-chain-melding/het dashboard en (2) het manco-profiel waarmee
 * de steekproef gericht wordt (zie inbound-sampling getMancoProfile).
 */
import { getDb } from "@/db";
import { receivingDiscrepancies, inboundShipments } from "@/db/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import type { ExpectedLine } from "@/lib/inbound";
import type { SamplePlan } from "@/lib/inbound-sampling";

type Shipment = typeof inboundShipments.$inferSelect;
type Count = { stockKey: string; sku: string; title: string; size: string; color: string; scannedQty: number; flagCode?: string; flagQty?: number };
export type DiscCode = "SHORT" | "OVER" | "DAMAGED" | "WRONG_ITEM" | "NOT_ORDERED" | "QUALITY" | "MISLABELED";

/** Leg de afwijkingen van een afgesloten ontvangst vast. Alleen GEVERIFIEERDE regels
 *  tellen mee: in steekproef-modus de gesamplede regels (de vertrouwde zijn op verwacht
 *  geboekt en gelden niet als afwijking), in 100%-modus alle regels. Plus onverwacht
 *  ontvangen artikelen (NOT_ORDERED). */
export async function logDiscrepancies(shipment: Shipment, counts: Count[], plan: SamplePlan | null): Promise<{ count: number; codes: Record<string, number> }> {
  const asn = (shipment.expectedLines as ExpectedLine[]) || [];
  const countByKey = new Map(counts.map((c) => [c.stockKey, c]));
  const sampleMode = plan?.mode === "sample";
  const verified = sampleMode ? new Set(plan!.sampledStockKeys) : new Set(asn.map((l) => l.stockKey));
  const base = {
    shipmentId: shipment.id, source: shipment.source, sourceType: shipment.sourceType,
    toStore: shipment.toStore, linkRef: shipment.linkRef,
  };
  const rows: (typeof receivingDiscrepancies.$inferInsert)[] = [];

  for (const l of asn) {
    if (!verified.has(l.stockKey)) continue; // vertrouwd → geen afwijking
    const scanned = countByKey.get(l.stockKey)?.scannedQty ?? 0;
    const variance = scanned - (Number(l.expectedQty) || 0);
    if (variance === 0) continue;
    rows.push({ ...base, stockKey: l.stockKey, sku: l.sku, title: l.title, size: l.size, color: l.color, expectedQty: l.expectedQty, scannedQty: scanned, variance, code: variance < 0 ? "SHORT" : "OVER" });
  }
  const asnKeys = new Set(asn.map((l) => l.stockKey));
  for (const c of counts) {
    if (asnKeys.has(c.stockKey) || c.scannedQty <= 0) continue;
    rows.push({ ...base, stockKey: c.stockKey, sku: c.sku, title: c.title, size: c.size, color: c.color, expectedQty: 0, scannedQty: c.scannedQty, variance: c.scannedQty, code: "NOT_ORDERED" });
  }
  // Expliciete schade-/verkeerd-meldingen (knoppen in de scanner): aparte afwijking
  // met de gekozen code, naast een eventuele tekort/teveel op dezelfde regel.
  for (const c of counts) {
    if (!c.flagCode || (c.flagQty ?? 0) <= 0) continue;
    const exp = asn.find((l) => l.stockKey === c.stockKey)?.expectedQty ?? 0;
    rows.push({ ...base, stockKey: c.stockKey, sku: c.sku, title: c.title, size: c.size, color: c.color, expectedQty: exp, scannedQty: c.scannedQty, variance: -(c.flagQty ?? 0), code: c.flagCode });
  }

  const codes: Record<string, number> = {};
  if (rows.length) {
    await getDb().insert(receivingDiscrepancies).values(rows);
    for (const r of rows) codes[r.code as string] = (codes[r.code as string] || 0) + 1;
  }
  return { count: rows.length, codes };
}

/** Open afwijkingen (voor de afhandel-lijst), nieuwste eerst. */
export async function listOpenDiscrepancies(toStore?: string, limit = 200) {
  const db = getDb();
  const lim = Math.max(1, Math.min(1000, limit));
  const cond = toStore
    ? and(eq(receivingDiscrepancies.status, "open"), eq(receivingDiscrepancies.toStore, toStore))
    : eq(receivingDiscrepancies.status, "open");
  return db.select().from(receivingDiscrepancies).where(cond).orderBy(desc(receivingDiscrepancies.createdAt)).limit(lim);
}

/** Een afwijking afhandelen (claim ingediend / credit / afgeschreven / opgelost). */
export async function resolveDiscrepancy(id: string, status: string, by?: string, note?: string) {
  const allowed = ["open", "claim_filed", "credited", "written_off", "resolved"];
  if (!allowed.includes(status)) return null;
  const done = ["credited", "written_off", "resolved"].includes(status);
  const db = getDb();
  const [r] = await db.update(receivingDiscrepancies)
    .set({ status, resolvedBy: by || "", note: note ?? undefined, resolvedAt: done ? new Date() : null })
    .where(eq(receivingDiscrepancies.id, id)).returning();
  return r || null;
}

/** Dashboard-cijfers (meetbaarheid): ontvangst-nauwkeurigheid per bron + winkel,
 *  code-verdeling, dock-to-stock-doorlooptijd. */
export async function getReceivingStats(days = 90) {
  const db = getDb();
  const since = new Date(Date.now() - Math.max(1, days) * 86400000).toISOString();

  // Nauwkeurigheid = % geverifieerde regels waar gescand == verwacht, per bron en per winkel.
  const acc = async (col: "source" | "to_store") => {
    const rows = await db.execute<{ k: string; lines: number; manco: number }>(sql`
      select lower(s.${sql.raw(col)}) as k, count(*)::int as lines,
        sum(case when c.scanned_qty <> c.expected_qty then 1 else 0 end)::int as manco
      from inbound_receipt_counts c
      join inbound_shipments s on s.id = c.shipment_id
      where s.status in ('received','closed') and s.received_at >= ${since}
      group by lower(s.${sql.raw(col)})
      order by manco desc`);
    return rows.rows.map((r) => ({ key: r.k, lines: r.lines, manco: r.manco, accuracy: r.lines ? 1 - r.manco / r.lines : 1 }));
  };
  const [accuracyBySource, accuracyByStore] = await Promise.all([acc("source"), acc("to_store")]);

  const codeRows = await db.execute<{ code: string; n: number }>(sql`
    select code, count(*)::int as n from receiving_discrepancies
    where created_at >= ${since} group by code order by n desc`);
  const codeBreakdown = Object.fromEntries(codeRows.rows.map((r) => [r.code, r.n]));

  const leadRows = await db.execute<{ source: string; hours: number; n: number }>(sql`
    select lower(source) as source,
      avg(extract(epoch from (received_at - in_transit_at)) / 3600.0)::float as hours,
      count(*)::int as n
    from inbound_shipments
    where status in ('received','closed') and received_at >= ${since} and in_transit_at is not null
    group by lower(source) order by hours desc nulls last`);
  const leadTimeBySource = leadRows.rows.map((r) => ({ source: r.source, avgHours: Math.round((r.hours || 0) * 10) / 10, shipments: r.n }));

  const [openAgg] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from receiving_discrepancies where status = 'open'`)).rows;

  return { accuracyBySource, accuracyByStore, codeBreakdown, leadTimeBySource, openCount: openAgg?.n || 0, windowDays: days };
}
