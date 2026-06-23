import { list } from "@vercel/blob";

/**
 * Voorraad uit de SRS-data-export (voorkeur van de business boven Shopify-stock).
 *
 * Bron: blob `srs-voorraad/srs-rows-latest.json` in de storegents-blobstore —
 * de RAUWE SRS-voorraad (alle filialen), gevuld door de SRS-SFTP-import 3×/dag.
 * Rij-formaat: { filiaalNummer, store, sku, voorraad, ideaal, tekort }.
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

const BLOB_PATH = "srs-voorraad/srs-rows-latest.json";
const TTL_MS = 5 * 60 * 1000;

let _index: StockIndex | null = null;
let _at = 0;
let _inflight: Promise<StockIndex> | null = null;
let _syncedAt: Date | null = null; // tijdstip van de laatste SRS-voorraadsync (blob)

function onlineBranchSet(): Set<string> | null {
  const raw = (process.env.GENTS_WEBSHOP_STOCK_BRANCHES || "").trim();
  if (!raw) return null; // null = tel alle filialen mee
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

async function loadIndex(): Promise<StockIndex> {
  const token =
    process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  const index: StockIndex = new Map();
  if (!token) return index; // geen token → lege index (PDP toont dan neutraal)

  const result = await list({ prefix: BLOB_PATH, limit: 1, token });
  const blob = result.blobs.find((b) => b.pathname === BLOB_PATH);
  if (!blob) return index;
  _syncedAt = blob.uploadedAt ? new Date(blob.uploadedAt) : null;

  const res = await fetch(`${blob.url}?_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return index;
  const data = (await res.json()) as { rows?: any[] };
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const online = onlineBranchSet();

  for (const r of rows) {
    const sku = String(r?.sku || "").trim();
    if (!sku) continue;
    const qty = Number(r?.voorraad) || 0;
    const branchId = String(r?.filiaalNummer || "").trim();
    const store = String(r?.store || `Filiaal ${branchId}`);
    const tekort = Number(r?.tekort) || 0;
    const ideaal = Number(r?.ideaal) || 0;
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
  return index;
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

/** Tijdstip van de laatste SRS-voorraadsync (blob-upload). Voor reservering-release. */
export async function stockSyncedAt(): Promise<Date | null> {
  await getIndex();
  return _syncedAt;
}
