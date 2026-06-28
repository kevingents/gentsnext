import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { storeStockMovements } from "@/db/schema";
import { stockForSkus, stockSyncedAt } from "@/lib/stock";
import { getSettings } from "@/lib/settings";
import { safetyStockFor } from "@/lib/fulfillment-config";

/**
 * Omnichannel voorraad-core (Fase A). De zelfgebouwde kassa (storegents) én de
 * webshop schrijven hier hun voorraad-mutaties naartoe — één transactioneel
 * grootboek bovenop de SRS-magazijn-baseline:
 *
 *   beschikbaar(locatie, artikel) = SRS-baseline(locatie) + Σ core-delta
 *
 * Append-only (audit + reconcilieerbaar). Idempotent op (ref, channel, stockKey)
 * zodat dezelfde verkoop niet dubbel boekt (offline-sync/retries).
 */

export type MovementLine = {
  barcode?: string | null;
  sku?: string | null;
  articleNumber?: string | null;
  qty: number;
  name?: string | null;
  color?: string | null;
  size?: string | null;
  lineType?: string | null; // 'custom' → geen voorraad-sleutel, overslaan
};

const norm = (v: unknown) => String(v ?? "").trim();
const lower = (v: unknown) => norm(v).toLowerCase();

/** Voorraad-sleutel van een regel: barcode > sku > artikelnummer (lowercase). */
export function stockKey(line: Pick<MovementLine, "barcode" | "sku" | "articleNumber"> = {}): string {
  return lower(line.barcode) || lower(line.sku) || lower(line.articleNumber);
}

export type RecordInput = {
  location: string;
  channel?: "pos" | "web" | "correction" | "inbound" | "transfer";
  reason?: string;
  ref?: string | null;
  /** sign −1 = verkoop/reservering (eraf), +1 = inboeken/retour/vrijgave (erbij). Default −1. */
  sign?: 1 | -1;
  lines: MovementLine[];
};

/** Boek mutaties in het core-grootboek (geaggregeerd per stockKey). Idempotent op ref. */
export async function recordMovements(input: RecordInput): Promise<{ applied: { stockKey: string; delta: number }[] }> {
  const location = norm(input.location);
  if (!location) throw new Error("location vereist");
  const sign = input.sign === 1 ? 1 : -1;
  const channel = input.channel || "web";
  const reason = norm(input.reason);
  const ref = input.ref ? norm(input.ref) : null;

  const byKey = new Map<string, { delta: number; meta: Record<string, string> }>();
  for (const l of input.lines || []) {
    if (l?.lineType === "custom") continue;
    const key = stockKey(l);
    const qty = Math.abs(Math.round(Number(l?.qty) || 0));
    if (!key || qty === 0) continue;
    const cur = byKey.get(key) || {
      delta: 0,
      meta: { name: norm(l.name), color: norm(l.color), size: norm(l.size), barcode: norm(l.barcode), sku: norm(l.sku) },
    };
    cur.delta += sign * qty;
    byKey.set(key, cur);
  }
  const rows = [...byKey.entries()].map(([key, v]) => ({
    location,
    stockKey: key,
    delta: v.delta,
    channel,
    reason,
    ref,
    meta: v.meta,
  }));
  if (!rows.length) return { applied: [] };

  const db = getDb();
  await db
    .insert(storeStockMovements)
    .values(rows)
    .onConflictDoNothing({
      target: [storeStockMovements.ref, storeStockMovements.channel, storeStockMovements.stockKey],
    });
  return { applied: rows.map((r) => ({ stockKey: r.stockKey, delta: r.delta })) };
}

/**
 * Markeer de kassa-mutaties van een verkoop (ref = sale-id) als 'in SRS geboekt'.
 * De delta blijft nog meetellen tot een SRS-sync ná dit moment de baseline
 * bijwerkt; daarna valt 'ie uit de posDelta-som (geen dubbeltelling). Aangeroepen
 * door storegents zodra een POS-verkoop succesvol naar SRS is gepost.
 */
export async function markMovementsSrsPosted(ref: string, channel: "pos" | "inbound" | "transfer" = "pos"): Promise<void> {
  const r = String(ref || "").trim();
  if (!r) return;
  const ch = (["inbound", "transfer"] as const).includes(channel as "inbound" | "transfer") ? channel : "pos";
  const db = getDb();
  await db.execute(sql`
    update store_stock_movements
    set srs_posted_at = now()
    where ref = ${r} and channel = ${ch} and srs_posted_at is null
  `);
}

/** Netto core-delta per stockKey voor één locatie. */
export async function coreDeltaForKeys(location: string, keys: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const loc = norm(location);
  const clean = [...new Set(keys.map(lower).filter(Boolean))];
  if (!loc || !clean.length) return out;
  const db = getDb();
  const syncedAt = (await stockSyncedAt()) ?? new Date(0);
  const rows = await db.execute<{ stock_key: string; net: number }>(sql`
    select stock_key, sum(delta)::int as net
    from store_stock_movements
    where location = ${loc} and stock_key in (${sql.join(clean.map((k) => sql`${k}`), sql`, `)})
      and (srs_posted_at is null or srs_posted_at >= ${syncedAt.toISOString()})
    group by stock_key
  `);
  for (const r of rows.rows) out.set(r.stock_key, Number(r.net) || 0);
  return out;
}

/**
 * Web-reserveringen per stockKey voor één locatie. Afgeleid uit de orders +
 * hun fulfillment_plan (welke locatie welk artikel levert), zodat de KASSA de
 * lopende web-orders meeneemt en het laatste stuk niet dubbel verkoopt.
 *
 * Telt mee zolang een web-order betaald-maar-niet-verzonden is, óf verzonden ná
 * de laatste SRS-sync (model A: magazijn/winkel boekt de pick in SRS uit; daarna
 * laat de sync 'm zakken → reservering valt vrij). Géén permanente boeking →
 * geen dubbeltelling met de SRS-baseline.
 */
export async function webReservedAllLocations(): Promise<Map<string, Map<string, number>>> {
  // locatie(lower) → (stockKey(lower) → gereserveerd aantal)
  const out = new Map<string, Map<string, number>>();
  const syncedAt = (await stockSyncedAt()) ?? new Date(0);
  try {
    const db = getDb();
    // Alléén web-orders met een fulfillment_plan (geïmporteerde historie heeft er geen → uitgesloten).
    const rows = await db.execute<{ fulfillment_plan: unknown }>(sql`
      select fulfillment_plan from orders
      where (status in ('paid','ready_pickup')
             or (status in ('shipped','delivered') and updated_at > ${syncedAt.toISOString()}))
        and fulfillment_plan is not null
    `);
    for (const r of rows.rows) {
      const plan = r.fulfillment_plan as { shipments?: { store?: string; lines?: { sku?: string; qty?: number }[] }[] } | null;
      for (const s of plan?.shipments || []) {
        const loc = lower(s.store);
        if (!loc) continue;
        let m = out.get(loc);
        if (!m) { m = new Map(); out.set(loc, m); }
        for (const l of s.lines || []) {
          const key = lower(l.sku);
          const qty = Math.abs(Math.round(Number(l.qty) || 0));
          if (!key || !qty) continue;
          m.set(key, (m.get(key) || 0) + qty);
        }
      }
    }
  } catch {
    // Bij een fout liever niets reserveren dan blokkeren.
  }
  return out;
}

/** Web-reserveringen per stockKey voor één locatie (gebruikt door de kassa-core). */
export async function webReservedForLocation(location: string): Promise<Map<string, number>> {
  const loc = lower(location);
  if (!loc) return new Map();
  return (await webReservedAllLocations()).get(loc) || new Map();
}

/** Kassa/pos-delta (core-grootboek) per locatie+stockKey voor een set artikelen. */
export async function posDeltaByLocationKey(keys: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const clean = [...new Set(keys.map(lower).filter(Boolean))];
  if (!clean.length) return out;
  const db = getDb();
  const syncedAt = (await stockSyncedAt()) ?? new Date(0);
  const rows = await db.execute<{ location: string; stock_key: string; net: number }>(sql`
    select location, stock_key, sum(delta)::int as net
    from store_stock_movements
    where stock_key in (${sql.join(clean.map((k) => sql`${k}`), sql`, `)})
      and (srs_posted_at is null or srs_posted_at >= ${syncedAt.toISOString()})
    group by location, stock_key
  `);
  for (const r of rows.rows) {
    const loc = lower(r.location);
    let m = out.get(loc);
    if (!m) { m = new Map(); out.set(loc, m); }
    m.set(String(r.stock_key), Number(r.net) || 0);
  }
  return out;
}

/**
 * Beschikbaar per artikel in één locatie =
 *   SRS-baseline(locatie) + core-delta(kassa/pos) − web-reservering(locatie).
 * Dit is de gedeelde waarheid: de kassa én de webshop rekenen hiermee, dus het
 * laatste stuk kan maar één keer verkocht worden (online of in de winkel).
 */
export async function availableInStore(location: string, keys: string[]): Promise<Map<string, number>> {
  const loc = norm(location);
  const clean = [...new Set(keys.map(norm).filter(Boolean))];
  const out = new Map<string, number>();
  if (!clean.length) return out;
  const [stock, delta, webRes, settings] = await Promise.all([
    stockForSkus(clean),
    coreDeltaForKeys(loc, clean),
    webReservedForLocation(loc),
    getSettings(),
  ]);
  for (const key of clean) {
    const st = stock.get(key);
    const branch = st ? st.byBranch.find((b) => lower(b.store) === lower(loc)) : undefined;
    const baseline = branch?.qty ?? 0;
    const safety = branch ? safetyStockFor(branch.branchId, settings) : 0;
    const net = baseline + (delta.get(lower(key)) || 0) - (webRes.get(lower(key)) || 0) - safety;
    out.set(key, Math.max(0, net));
  }
  return out;
}

/**
 * Beschikbaar mét uitsplitsing per artikel in één locatie — voor de kassa-weergave
 * (read-side cut-over): { baseline (SRS), posDelta (kassa), webReserved, available }.
 * Eén bron: de kassa toont deze getallen i.p.v. z'n eigen Blob-core.
 */
export async function availableBreakdown(
  location: string,
  keys: string[],
): Promise<Map<string, { baseline: number; posDelta: number; webReserved: number; safety: number; available: number }>> {
  const loc = norm(location);
  const clean = [...new Set(keys.map(norm).filter(Boolean))];
  const out = new Map<string, { baseline: number; posDelta: number; webReserved: number; safety: number; available: number }>();
  if (!clean.length) return out;
  const [stock, delta, webRes, settings] = await Promise.all([
    stockForSkus(clean),
    coreDeltaForKeys(loc, clean),
    webReservedForLocation(loc),
    getSettings(),
  ]);
  for (const key of clean) {
    const st = stock.get(key);
    const branch = st ? st.byBranch.find((b) => lower(b.store) === lower(loc)) : undefined;
    const baseline = branch?.qty ?? 0;
    const safety = branch ? safetyStockFor(branch.branchId, settings) : 0;
    const posDelta = delta.get(lower(key)) || 0;
    const webReserved = webRes.get(lower(key)) || 0;
    out.set(key, { baseline, posDelta, webReserved, safety, available: Math.max(0, baseline + posDelta - webReserved - safety) });
  }
  return out;
}

/** Recente core-mutaties (nieuwste eerst), optioneel op locatie. */
export async function listMovements(location?: string, limit = 100) {
  const db = getDb();
  const loc = norm(location);
  const rows = await db.execute<Record<string, unknown>>(sql`
    select id, location, stock_key, delta, channel, reason, ref, created_at
    from store_stock_movements
    ${loc ? sql`where location = ${loc}` : sql``}
    order by created_at desc
    limit ${Math.max(1, Math.min(500, limit))}
  `);
  return rows.rows;
}
