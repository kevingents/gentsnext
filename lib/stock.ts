import { readActiveBaseline } from "@/lib/srs-stock-core";

/**
 * Voorraad uit de SRS-data-export (voorkeur van de business boven Shopify-stock).
 *
 * Bron: Neon-tabel `srs_stock` (bron van waarheid; de storegents SRS-import pusht
 * de volledige baseline structureel via /api/core/stock/baseline — uurlijkse cron,
 * en de import-marker schuift daar pas op als de push gecommit is, dus een gemiste
 * push wordt vanzelf opnieuw geprobeerd; zie lib/srs-stock-core). De oude
 * transitie-fallback op de cross-repo blob `srs-voorraad/srs-rows-latest.json`
 * is verwijderd.
 *
 * We bouwen één keer per proces (5 min TTL) een SKU-index:
 *   sku → { total, online, byBranch: [{ branchId, store, qty }] }
 * - total  = som van positieve voorraad over álle filialen (in-company)
 * - online = som over de webshop-/magazijnfilialen (env GENTS_WEBSHOP_STOCK_BRANCHES,
 *            comma-gescheiden; leeg = gelijk aan total)
 * Per-branch is voor click & collect ("op voorraad in winkel X").
 */

export type BranchStock = { branchId: string; store: string; qty: number; tekort: number; ideaal: number };
export type SkuStock = { total: number; online: number; byBranch: BranchStock[] };

type StockIndex = Map<string, SkuStock>;

const TTL_MS = 5 * 60 * 1000;

let _index: StockIndex | null = null;
let _at = 0;
let _inflight: Promise<StockIndex> | null = null;
let _syncedAt: Date | null = null; // tijdstip van de laatste SRS-voorraadsync (Neon-baseline)

export function onlineBranchSet(): Set<string> | null {
  const raw = (process.env.GENTS_WEBSHOP_STOCK_BRANCHES || "").trim();
  if (!raw) return null; // null = tel alle filialen mee
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/** Voeg één voorraad-rij toe aan de index. */
function addRow(
  index: StockIndex,
  online: Set<string> | null,
  sku: string,
  qty: number,
  branchId: string,
  store: string,
  tekort: number,
  ideaal: number
) {
  if (!sku) return;
  let entry = index.get(sku);
  if (!entry) {
    entry = { total: 0, online: 0, byBranch: [] };
    index.set(sku, entry);
  }
  if (qty > 0) {
    entry.total += qty;
    if (!online || online.has(branchId)) entry.online += qty;
    entry.byBranch.push({ branchId, store, qty, tekort, ideaal });
  }
}

/** Bron van waarheid: de Neon-baseline (active gen). Null → nog niet gevuld. */
async function loadIndexFromNeon(): Promise<StockIndex | null> {
  try {
    const { gen, rows, syncedAt } = await readActiveBaseline();
    if (!gen || !rows.length) return null;
    const index: StockIndex = new Map();
    const online = onlineBranchSet();
    for (const r of rows) {
      const branchId = String(r.branchId || "").trim();
      addRow(index, online, String(r.sku || "").trim(), Number(r.qty) || 0, branchId, r.store || `Filiaal ${branchId}`, r.tekort, r.ideaal);
    }
    _syncedAt = syncedAt;
    return index;
  } catch {
    return null; // Neon onbereikbaar → lege index (PDP toont dan neutraal)
  }
}

async function loadIndex(): Promise<StockIndex> {
  return (await loadIndexFromNeon()) ?? new Map();
}

async function getIndex(): Promise<StockIndex> {
  if (_index && Date.now() - _at < TTL_MS) return _index;
  if (_inflight) return _inflight;
  _inflight = loadIndex()
    .then((idx) => {
      _index = idx;
      _at = Date.now();
      return idx;
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

const EMPTY: SkuStock = { total: 0, online: 0, byBranch: [] };

/** Voorraad voor één SKU. */
export async function stockForSku(sku: string): Promise<SkuStock> {
  if (!sku) return EMPTY;
  const idx = await getIndex();
  return idx.get(sku.trim()) || EMPTY;
}

/** Voorraad voor meerdere SKU's in één keer (PDP/variantenlijst). */
export async function stockForSkus(skus: string[]): Promise<Map<string, SkuStock>> {
  const idx = await getIndex();
  const out = new Map<string, SkuStock>();
  for (const sku of skus) {
    const key = String(sku || "").trim();
    if (key) out.set(key, idx.get(key) || EMPTY);
  }
  return out;
}

/** Of de voorraad-index überhaupt geladen kon worden (anders: neutraal tonen). */
export async function stockAvailable(): Promise<boolean> {
  const idx = await getIndex();
  return idx.size > 0;
}

/** Tijdstip van de laatste SRS-voorraadsync (Neon-baseline). Voor reservering-release. */
export async function stockSyncedAt(): Promise<Date | null> {
  await getIndex();
  return _syncedAt;
}
