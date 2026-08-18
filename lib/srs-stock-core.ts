import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import { srsStock, srsStockLive } from "@/db/schema";

/**
 * SRS-voorraadbaseline in Neon — bron van waarheid voor de bruto fysieke voorraad
 * per SKU per filiaal (vervangt de cross-repo blob srs-voorraad/srs-rows-latest.json
 * die de webshop las via een gedeeld storegents-token).
 *
 * Snapshot-model met generatie-swap (atomair, geen read-modify-write):
 *   begin()  → nieuwe gen (uuid)
 *   upsert() → de storegents-import pusht de volledige snapshot in batches onder gen
 *   commit() → srs_stock_meta.active_gen flipt naar gen (+ synced_at); oude gen op-
 *              geruimd. Reads filteren op active_gen → een half-geschreven sync is
 *              onzichtbaar; een lege push wordt geweigerd (nooit de site leegtrekken).
 *
 * Alle reads binnen gentsnext gaan direct via getDb() (geen HTTP). Alleen de
 * storegents-import schrijft (via het core-endpoint /api/core/stock/baseline).
 */

export type BaselineRowInput = {
  sku: string;
  branchId: string;
  store?: string;
  qty: number;
  tekort?: number;
  ideaal?: number;
};

export type BaselineRow = {
  sku: string;
  branchId: string;
  store: string;
  qty: number;
  tekort: number;
  ideaal: number;
};

const norm = (v: unknown) => String(v ?? "").trim();
const int = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Start een nieuwe baseline-generatie. Formaat: `<epoch-ms>-<uuid>`. De tijd-prefix
 * maakt generaties chronologisch sorteerbaar (split_part(gen,'-',1)::bigint), zodat de
 * commit alleen STRIKT OUDERE generaties opruimt en active_gen monotoon vooruit gaat —
 * veilig bij twee gelijktijdige SRS-imports (neon-http kent geen transactie/lock die
 * begin→upsert→commit serialiseert). Puur een stempel; nog niets actief.
 */
export function beginBaselineGen(): string {
  return `${Date.now()}-${randomUUID()}`;
}

/**
 * Voeg een batch baseline-rijen toe onder één gen. Idempotent op (gen, branch, sku)
 * zodat een her-verzonden batch niet dubbelt. Dedupt binnen de batch (Postgres kan
 * dezelfde conflict-target niet 2× in één statement raken).
 */
export async function upsertBaselineRows(gen: string, rows: BaselineRowInput[]): Promise<{ ok: boolean; inserted: number; error?: string }> {
  const g = norm(gen);
  if (!g) return { ok: false, inserted: 0, error: "gen vereist." };
  const byKey = new Map<string, BaselineRow>();
  for (const r of rows || []) {
    const sku = norm(r?.sku);
    const branchId = norm(r?.branchId);
    if (!sku || !branchId) continue;
    byKey.set(`${branchId}|${sku}`, {
      sku,
      branchId,
      store: norm(r?.store),
      qty: int(r?.qty),
      tekort: int(r?.tekort),
      ideaal: int(r?.ideaal),
    });
  }
  const values = [...byKey.values()].map((r) => ({ ...r, gen: g }));
  if (!values.length) return { ok: true, inserted: 0 };
  const db = getDb();
  await db
    .insert(srsStock)
    .values(values)
    .onConflictDoUpdate({
      target: [srsStock.gen, srsStock.branchId, srsStock.sku],
      set: {
        store: sql`excluded.store`,
        qty: sql`excluded.qty`,
        tekort: sql`excluded.tekort`,
        ideaal: sql`excluded.ideaal`,
      },
    });
  return { ok: true, inserted: values.length };
}

/**
 * Maak de gen actief + ruim oude generaties op. Concurrency-veilig zonder transactie:
 *  - lege-generatie-guard: weigert commit bij 0 rijen (nooit de voorraad op 0 zetten);
 *  - MONOTONE flip: active_gen gaat alleen naar een NIEUWERE (of gelijke) generatie
 *    (één conditionele upsert met RETURNING) → een trager/ouder gelijktijdig import
 *    kan de baseline nooit terugzetten of laten flip-floppen;
 *  - GESCOPTE cleanup: verwijdert uitsluitend STRIKT OUDERE generaties, dus nooit de
 *    rijen van een gelijktijdig geschreven nieuwere generatie (dat was de race).
 * Verliest deze commit de flip (er is al een nieuwere baseline actief), dan ruimt 'ie
 * alleen z'n eigen — achterhaalde — rijen op.
 */
export async function commitBaselineGen(
  gen: string,
  syncedAt?: string | Date | null,
): Promise<{ ok: boolean; rowCount?: number; superseded?: boolean; error?: string }> {
  const g = norm(gen);
  if (!g) return { ok: false, error: "gen vereist." };
  const db = getDb();
  const cnt = await db.execute<{ n: number }>(sql`select count(*)::int as n from srs_stock where gen = ${g}`);
  const rowCount = Number(cnt.rows?.[0]?.n) || 0;
  if (rowCount === 0) return { ok: false, error: "Lege generatie — commit geweigerd (baseline ongewijzigd)." };

  const synced = syncedAt ? new Date(syncedAt) : new Date();
  // Conditionele (monotone) flip: word alleen actief als deze gen niet ouder is dan de
  // huidige. RETURNING geeft de rij terug wanneer de flip doorging; bij een oudere gen
  // is de WHERE onwaar → geen update → geen returned row.
  const flip = await db.execute<{ active_gen: string }>(sql`
    insert into srs_stock_meta (id, active_gen, synced_at, row_count, updated_at)
    values ('latest', ${g}, ${synced}, ${rowCount}, now())
    on conflict (id) do update
      set active_gen = excluded.active_gen, synced_at = excluded.synced_at,
          row_count = excluded.row_count, updated_at = now()
      where srs_stock_meta.active_gen is null
         or split_part(excluded.active_gen, '-', 1)::bigint
            >= split_part(srs_stock_meta.active_gen, '-', 1)::bigint
    returning active_gen
  `);
  const won = flip.rows?.[0]?.active_gen === g;
  if (!won) {
    // Een nieuwere snapshot is al actief → deze push is achterhaald; ruim alleen de
    // eigen rijen op (niet de winnende gen aanraken).
    try {
      await db.execute(sql`delete from srs_stock where gen = ${g}`);
    } catch {
      /* niet-fataal */
    }
    return { ok: true, rowCount, superseded: true };
  }
  // Opruimen: uitsluitend STRIKT OUDERE generaties (op tijd-prefix) — nooit een
  // gelijktijdig geschreven nieuwere gen. Faalt dit, dan blijven ze staan (enkel opslag).
  try {
    await db.execute(sql`
      delete from srs_stock
      where gen <> ${g}
        and split_part(gen, '-', 1)::bigint < split_part(${g}, '-', 1)::bigint
    `);
  } catch {
    /* niet-fataal */
  }
  return { ok: true, rowCount };
}

export async function activeBaselineMeta(): Promise<{ activeGen: string | null; syncedAt: Date | null; rowCount: number }> {
  const db = getDb();
  const r = await db.execute<{ active_gen: string | null; synced_at: string | null; row_count: number }>(
    sql`select active_gen, synced_at, row_count from srs_stock_meta where id = 'latest' limit 1`,
  );
  const row = r.rows?.[0];
  return {
    activeGen: row?.active_gen ? String(row.active_gen) : null,
    syncedAt: row?.synced_at ? new Date(row.synced_at) : null,
    rowCount: Number(row?.row_count) || 0,
  };
}

/**
 * Lees de volledige actieve baseline (alle filialen) + het sync-tijdstip. Voor
 * lib/stock.ts, dat er dezelfde SKU-index van bouwt als voorheen uit de blob.
 * Leeg → gen null (lib/stock valt dan terug op de blob).
 */
export async function readActiveBaseline(): Promise<{ gen: string | null; syncedAt: Date | null; rows: BaselineRow[] }> {
  const meta = await activeBaselineMeta();
  if (!meta.activeGen) return { gen: null, syncedAt: null, rows: [] };
  const db = getDb();
  const res = await db.execute<{ sku: string; branch_id: string; store: string; qty: number; tekort: number; ideaal: number }>(sql`
    select sku, branch_id, store, qty, tekort, ideaal
    from srs_stock
    where gen = ${meta.activeGen}
  `);
  const rows: BaselineRow[] = res.rows.map((r) => ({
    sku: String(r.sku),
    branchId: String(r.branch_id),
    store: String(r.store || ""),
    qty: Number(r.qty) || 0,
    tekort: Number(r.tekort) || 0,
    ideaal: Number(r.ideaal) || 0,
  }));
  return { gen: meta.activeGen, syncedAt: meta.syncedAt, rows };
}

/* ── Live-schaduw (srs_stock_live): 5-min storeinfo-SFTP-delta's ─────────────────
   Fase 1 van "alles naar Neon": de storegents delta-cron schrijft de absolute
   standen uit het delta/full-XML hier dual-write naast de blob. Nog GEEN lezers —
   eerst pariteit bewijzen, dan de leesformules (per-artikel-watermark) omzetten.
   Bewust géén koppeling met srs_stock_meta.synced_at: dat watermark stuurt de
   movement-/reserveringsvensters en mag alleen door een VOLLEDIGE baseline-sync
   bewogen worden. */

export type LiveStockRowInput = { sku: string; branchId: string; store?: string; qty: number };

const LIVE_BATCH_MAX = 5000;

/**
 * Upsert een batch live-standen (laatste wint per (filiaal, sku)). qty is de
 * absolute stand uit de feed — negatief blijft negatief (trouwe spiegel; lezers
 * clampen straks zelf). Dedupt binnen de batch op (branchId|sku).
 */
export async function applyLiveStockRows(rows: LiveStockRowInput[]): Promise<{ ok: boolean; upserted: number; error?: string }> {
  const byKey = new Map<string, { sku: string; branchId: string; store: string; qty: number }>();
  for (const r of rows || []) {
    const sku = norm(r?.sku);
    const branchId = norm(r?.branchId);
    if (!sku || !branchId) continue;
    byKey.set(`${branchId}|${sku}`, { sku, branchId, store: norm(r?.store), qty: int(r?.qty) });
  }
  const values = [...byKey.values()];
  if (!values.length) return { ok: true, upserted: 0 };
  if (values.length > LIVE_BATCH_MAX) return { ok: false, upserted: 0, error: `Batch te groot (max ${LIVE_BATCH_MAX}).` };
  const db = getDb();
  await db
    .insert(srsStockLive)
    .values(values)
    .onConflictDoUpdate({
      target: [srsStockLive.branchId, srsStockLive.sku],
      set: {
        store: sql`excluded.store`,
        qty: sql`excluded.qty`,
        updatedAt: sql`now()`,
      },
    });
  return { ok: true, upserted: values.length };
}

/**
 * Maak de live-stand van hele filialen leeg — de full-run (1×/nacht) stuurt dit
 * vóór z'n batches, zodat rijen die uit het full-XML verdwenen zijn niet als
 * spookstand blijven hangen (het delta-XML noemt alleen gewijzigde barcodes).
 */
export async function clearLiveStockBranches(branchIds: string[]): Promise<{ ok: boolean; cleared: number; error?: string }> {
  const clean = [...new Set((branchIds || []).map(norm).filter(Boolean))];
  if (!clean.length) return { ok: true, cleared: 0 };
  if (clean.length > 100) return { ok: false, cleared: 0, error: "Te veel filialen in één clear." };
  const db = getDb();
  await db.execute(sql`
    delete from srs_stock_live
    where branch_id in (${sql.join(clean.map((b) => sql`${b}`), sql`, `)})
  `);
  return { ok: true, cleared: clean.length };
}

export type BranchStockStats = { branchId: string; store: string; skus: number; qty: number };

/**
 * Per-filiaal aggregaten van de actieve baseline én de live-schaduwtabel, plus
 * de watermerken — voor de dagelijkse voorraad-pariteitsmonitor in storegents
 * (vergelijkt Neon vs de kassa-blob en alarmeert bij een Den Bosch-profiel:
 * één bron vrijwel leeg terwijl de ander vol staat).
 */
export async function liveStockStats(): Promise<{
  gen: BranchStockStats[];
  live: BranchStockStats[];
  genSyncedAt: Date | null;
  liveNewestAt: Date | null;
}> {
  const db = getDb();
  const meta = await activeBaselineMeta();
  const gen: BranchStockStats[] = [];
  if (meta.activeGen) {
    const res = await db.execute<{ branch_id: string; store: string; skus: number; qty: number }>(sql`
      select branch_id, max(store) as store,
             count(*) filter (where qty > 0)::int as skus,
             coalesce(sum(qty) filter (where qty > 0), 0)::int as qty
      from srs_stock
      where gen = ${meta.activeGen}
      group by branch_id
    `);
    for (const r of res.rows) gen.push({ branchId: String(r.branch_id), store: String(r.store || ""), skus: Number(r.skus) || 0, qty: Number(r.qty) || 0 });
  }
  const live: BranchStockStats[] = [];
  let liveNewestAt: Date | null = null;
  const res = await db.execute<{ branch_id: string; store: string; skus: number; qty: number; newest: string | null }>(sql`
    select branch_id, max(store) as store,
           count(*) filter (where qty > 0)::int as skus,
           coalesce(sum(qty) filter (where qty > 0), 0)::int as qty,
           max(updated_at) as newest
    from srs_stock_live
    group by branch_id
  `);
  for (const r of res.rows) {
    live.push({ branchId: String(r.branch_id), store: String(r.store || ""), skus: Number(r.skus) || 0, qty: Number(r.qty) || 0 });
    if (r.newest) {
      const d = new Date(r.newest);
      if (!liveNewestAt || d > liveNewestAt) liveNewestAt = d;
    }
  }
  return { gen, live, genSyncedAt: meta.syncedAt, liveNewestAt };
}
