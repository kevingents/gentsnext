/**
 * Steekproef voor de goederenontvangst (F2) — manco-gedreven. De steekproef is NIET
 * puur random: artikelen die historisch vaker MANCO komen (en bronnen die vaker manco
 * leveren) worden gericht gecontroleerd, daarbovenop een waarde-gewogen statistische
 * steekproef voor dekking. AQL-acceptatie/afkeuring (ANSI/ASQ-Z1.4-achtig) met
 * blind-count + escalatie naar 100%, en een lerend bron-vertrouwen.
 *
 * Manco-profiel = afgeleid uit de eigen ontvangst-historie (inbound_receipt_counts van
 * afgesloten zendingen): per stockKey en per bron hoe vaak gescand-aantal ≠ verwacht.
 */
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { getReceivingConfig, type ReceivingConfig } from "@/lib/receiving-config";
import type { ExpectedLine } from "@/lib/inbound";

export type TrustLevel = "new" | "tightened" | "normal" | "reduced";
export type SamplePlan = {
  mode: "full" | "sample";
  reason: string;
  trustLevel: TrustLevel;
  sampledStockKeys: string[];
  mandatoryStockKeys: string[]; // probleemartikelen die verplicht meegeteld worden
  n: number;  // aantal te tellen regels
  L: number;  // totaal regels
  N: number;  // totaal stuks
  ac: number; // accepteer bij ≤ ac afwijkende steekproefregels
  re: number; // afkeuren bij ≥ re
  aql: number;
};

export type MancoProfile = {
  byStockKey: Map<string, { counted: number; manco: number; rate: number }>;
  bySource: Map<string, { shipments: number; counted: number; manco: number; lineRate: number }>;
};

/** Manco-historie uit afgesloten ontvangsten binnen het venster. */
export async function getMancoProfile(windowDays: number): Promise<MancoProfile> {
  const db = getDb();
  const since = new Date(Date.now() - Math.max(1, windowDays) * 86400000).toISOString();
  const rows = await db.execute<{ source: string; stock_key: string; cnt: number; manco: number }>(sql`
    select lower(s.source) as source, c.stock_key,
      count(*)::int as cnt,
      sum(case when c.scanned_qty <> c.expected_qty then 1 else 0 end)::int as manco
    from inbound_receipt_counts c
    join inbound_shipments s on s.id = c.shipment_id
    where s.status in ('received','closed') and s.received_at >= ${since}
    group by lower(s.source), c.stock_key`);

  const byStockKey = new Map<string, { counted: number; manco: number; rate: number }>();
  const bySourceLines = new Map<string, { counted: number; manco: number }>();
  for (const r of rows.rows) {
    const a = byStockKey.get(r.stock_key) || { counted: 0, manco: 0, rate: 0 };
    a.counted += r.cnt; a.manco += r.manco; byStockKey.set(r.stock_key, a);
    const s = bySourceLines.get(r.source) || { counted: 0, manco: 0 };
    s.counted += r.cnt; s.manco += r.manco; bySourceLines.set(r.source, s);
  }
  for (const a of byStockKey.values()) a.rate = a.counted ? a.manco / a.counted : 0;

  const shipRows = await db.execute<{ source: string; shipments: number }>(sql`
    select lower(source) as source, count(*)::int as shipments
    from inbound_shipments where status in ('received','closed') and received_at >= ${since}
    group by lower(source)`);
  const bySource = new Map<string, { shipments: number; counted: number; manco: number; lineRate: number }>();
  for (const r of shipRows.rows) {
    const sl = bySourceLines.get(r.source) || { counted: 0, manco: 0 };
    bySource.set(r.source, { shipments: r.shipments, counted: sl.counted, manco: sl.manco, lineRate: sl.counted ? sl.manco / sl.counted : 0 });
  }
  return { byStockKey, bySource };
}

/** Stukprijzen (cents) per stockKey voor de high-value-override (pakken → 100%). */
async function pricesForLines(lines: ExpectedLine[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const skus = [...new Set(lines.map((l) => l.sku).filter(Boolean))];
  if (!skus.length) return out;
  const db = getDb();
  const rows = await db.execute<{ sku: string; price_cents: number }>(sql`
    select v.sku, v.price_cents from product_variants v
    where v.sku in (${sql.join(skus.map((s) => sql`${s}`), sql`, `)})`);
  const bySku = new Map(rows.rows.map((r) => [r.sku, Number(r.price_cents) || 0]));
  for (const l of lines) { const p = bySku.get(l.sku); if (p != null) out.set(l.stockKey, p); }
  return out;
}

/** Bouw het steekproefplan voor een zending. */
export async function buildSamplePlan(
  shipment: { source?: string; expectedLines?: unknown },
  config?: ReceivingConfig,
  profile?: MancoProfile,
): Promise<SamplePlan> {
  const cfg = config || (await getReceivingConfig());
  const lines = ((shipment.expectedLines as ExpectedLine[]) || []).filter((l) => l && l.stockKey);
  const L = lines.length;
  const N = lines.reduce((s, l) => s + (Number(l.expectedQty) || 0), 0);
  const empty = { sampledStockKeys: [] as string[], mandatoryStockKeys: [] as string[], aql: cfg.aql };
  if (L === 0) return { mode: "full", reason: "geen regels", trustLevel: "normal", n: 0, L, N, ac: 0, re: 1, ...empty };

  const prof = profile || (await getMancoProfile(cfg.mancoWindowDays));
  const source = String(shipment.source || "").toLowerCase();
  const ss = prof.bySource.get(source) || { shipments: 0, counted: 0, manco: 0, lineRate: 0 };

  let trustLevel: TrustLevel = "normal";
  if (ss.shipments < cfg.newSourceReceipts) trustLevel = "new";
  else if (ss.lineRate >= cfg.sourceTightenRate) trustLevel = "tightened";
  else if (ss.lineRate <= cfg.sourceReducedRate && ss.shipments >= cfg.reducedAfterCleanReceipts) trustLevel = "reduced";

  const priceByKey = await pricesForLines(lines);
  const maxPrice = lines.reduce((m, l) => Math.max(m, priceByKey.get(l.stockKey) || 0), 0);
  const highValue = maxPrice >= cfg.highValueCents;

  // STEP 0 — 100% tellen?
  if (N <= cfg.smallLotPieces || trustLevel === "new" || trustLevel === "tightened" || highValue) {
    const why = N <= cfg.smallLotPieces ? `kleine partij (${N} stuks)`
      : trustLevel === "new" ? "nieuwe bron (nog geen historie)"
      : trustLevel === "tightened" ? "bron met manco-historie"
      : `hoge waarde (max €${Math.round(maxPrice / 100)})`;
    return { mode: "full", reason: `100% tellen — ${why}`, trustLevel, sampledStockKeys: lines.map((l) => l.stockKey), mandatoryStockKeys: [], n: L, L, N, ac: 0, re: 1, aql: cfg.aql };
  }

  // STEP 1 — verplicht: probleemartikelen (manco-historie) die in deze zending zitten.
  const mandatory = lines.filter((l) => {
    const m = prof.byStockKey.get(l.stockKey);
    return m && m.manco >= cfg.mancoLineMinHits && m.rate >= cfg.mancoLineRate;
  }).map((l) => l.stockKey);
  const mandatorySet = new Set(mandatory);

  // STEP 2 — statistische steekproefgrootte (wortel-schaling × bron-vertrouwen).
  const trustFactor = trustLevel === "reduced" ? cfg.trustFactorReduced : 1.0;
  const nTarget = Math.max(cfg.nMin, Math.min(L, Math.ceil(1.5 * Math.sqrt(L) * trustFactor)));

  // Waarde-gewogen: vul aan met de duurste niet-verplichte regels.
  const candidates = lines.filter((l) => !mandatorySet.has(l.stockKey))
    .sort((a, b) => (priceByKey.get(b.stockKey) || 0) - (priceByKey.get(a.stockKey) || 0));
  const statistical = candidates.slice(0, Math.max(0, nTarget - mandatory.length)).map((l) => l.stockKey);

  const sampledStockKeys = [...mandatory, ...statistical];
  const n = sampledStockKeys.length;
  const ac = Math.floor(n * cfg.aql);
  const re = ac + 1;
  const reason = `steekproef ${n} van ${L} regels${mandatory.length ? ` · ${mandatory.length} probleemartikel(en) verplicht` : ""} · bron-vertrouwen ${trustLevel}`;
  return { mode: "sample", reason, trustLevel, sampledStockKeys, mandatoryStockKeys: mandatory, n, L, N, ac, re, aql: cfg.aql };
}
