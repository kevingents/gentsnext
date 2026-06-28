import { list } from "@vercel/blob";

/**
 * Steekproef-instellingen voor de goederenontvangst (F2). Instelbaar via de
 * portal (Instellingen → settings-blob `config/receiving-config.json`); gentsnext
 * leest 'm direct (zelfde patroon als reservation-config). Alles heeft een veilige
 * default zodat 't out-of-the-box werkt. Config in de tool, NIET in Vercel-env.
 */

const KEY = "config/receiving-config.json";
const TTL_MS = 60_000;

export type ReceivingConfig = {
  aql: number;                 // acceptance quality limit (fractie afwijkende steekproefregels die nog mag)
  nMin: number;                // minimale steekproefgrootte (regels)
  smallLotPieces: number;      // ≤ dit aantal stuks → 100% tellen
  highValueCents: number;      // een regel met stukprijs ≥ dit → die levering 100% tellen (pakken!)
  mancoWindowDays: number;     // historie-venster voor het manco-profiel
  mancoLineRate: number;       // stockKey is 'probleemartikel' als manco-rate ≥ dit ...
  mancoLineMinHits: number;    // ... én minimaal zoveel keer manco gezien
  sourceTightenRate: number;   // bron-manco-rate ≥ dit → tightened (100%)
  sourceReducedRate: number;   // bron-manco-rate ≤ dit (+ genoeg schone ontvangsten) → reduced
  reducedAfterCleanReceipts: number; // zoveel schone ontvangsten → reduced
  newSourceReceipts: number;   // minder ontvangsten dan dit = 'nieuwe bron' → 100%
  trustFactorReduced: number;  // steekproef-multiplier voor betrouwbare bron (<1 = kleiner)
};

const DEFAULTS: ReceivingConfig = {
  aql: 0.025,
  nMin: 8,
  smallLotPieces: 20,
  highValueCents: 15000, // € 150
  mancoWindowDays: 180,
  mancoLineRate: 0.15,
  mancoLineMinHits: 2,
  sourceTightenRate: 0.10,
  sourceReducedRate: 0.02,
  reducedAfterCleanReceipts: 10,
  newSourceReceipts: 3,
  trustFactorReduced: 0.6,
};

function blobToken(): string {
  return process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
}
function num(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
}

let cache: { cfg: ReceivingConfig; at: number } | null = null;

export async function getReceivingConfig(): Promise<ReceivingConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.cfg;
  let cfg = { ...DEFAULTS };
  try {
    const token = blobToken();
    if (token) {
      const { blobs } = await list({ prefix: KEY, limit: 1, token });
      const b = (blobs || []).find((x) => x.pathname === KEY);
      if (b) {
        const res = await fetch(`${b.url}?_=${Date.now()}`, { cache: "no-store" });
        if (res.ok) {
          const d = (await res.json()) as Partial<Record<keyof ReceivingConfig, unknown>>;
          cfg = {
            aql: num(d.aql, DEFAULTS.aql, 0, 0.2),
            nMin: num(d.nMin, DEFAULTS.nMin, 1, 200),
            smallLotPieces: num(d.smallLotPieces, DEFAULTS.smallLotPieces, 0, 1000),
            highValueCents: num(d.highValueCents, DEFAULTS.highValueCents, 0, 1_000_000),
            mancoWindowDays: num(d.mancoWindowDays, DEFAULTS.mancoWindowDays, 7, 730),
            mancoLineRate: num(d.mancoLineRate, DEFAULTS.mancoLineRate, 0, 1),
            mancoLineMinHits: num(d.mancoLineMinHits, DEFAULTS.mancoLineMinHits, 1, 50),
            sourceTightenRate: num(d.sourceTightenRate, DEFAULTS.sourceTightenRate, 0, 1),
            sourceReducedRate: num(d.sourceReducedRate, DEFAULTS.sourceReducedRate, 0, 1),
            reducedAfterCleanReceipts: num(d.reducedAfterCleanReceipts, DEFAULTS.reducedAfterCleanReceipts, 1, 1000),
            newSourceReceipts: num(d.newSourceReceipts, DEFAULTS.newSourceReceipts, 0, 100),
            trustFactorReduced: num(d.trustFactorReduced, DEFAULTS.trustFactorReduced, 0.1, 1),
          };
        }
      }
    }
  } catch {
    // Blob onbereikbaar → defaults.
  }
  cache = { cfg, at: Date.now() };
  return cfg;
}

export { DEFAULTS as RECEIVING_DEFAULTS };
