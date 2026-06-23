import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { storeStockMovements } from "@/db/schema";
import { stockForSkus } from "@/lib/stock";

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
  channel?: "pos" | "web" | "correction";
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

/** Netto core-delta per stockKey voor één locatie. */
export async function coreDeltaForKeys(location: string, keys: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const loc = norm(location);
  const clean = [...new Set(keys.map(lower).filter(Boolean))];
  if (!loc || !clean.length) return out;
  const db = getDb();
  const rows = await db.execute<{ stock_key: string; net: number }>(sql`
    select stock_key, sum(delta)::int as net
    from store_stock_movements
    where location = ${loc} and stock_key in (${sql.join(clean.map((k) => sql`${k}`), sql`, `)})
    group by stock_key
  `);
  for (const r of rows.rows) out.set(r.stock_key, Number(r.net) || 0);
  return out;
}

/**
 * Beschikbaar per artikel in één locatie = SRS-baseline (winkelvoorraad uit de
 * SFTP-blob, gematcht op winkelnaam) + core-delta. Geeft een map key → aantal.
 */
export async function availableInStore(location: string, keys: string[]): Promise<Map<string, number>> {
  const loc = norm(location);
  const clean = [...new Set(keys.map(norm).filter(Boolean))];
  const out = new Map<string, number>();
  if (!clean.length) return out;
  const [stock, delta] = await Promise.all([stockForSkus(clean), coreDeltaForKeys(loc, clean)]);
  for (const key of clean) {
    const st = stock.get(key);
    const baseline = st
      ? st.byBranch.find((b) => lower(b.store) === lower(loc))?.qty ?? 0
      : 0;
    out.set(key, Math.max(0, baseline + (delta.get(lower(key)) || 0)));
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
