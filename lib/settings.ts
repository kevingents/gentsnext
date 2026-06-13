import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";

/**
 * Centrale, in de backend instelbare configuratie. Eén bron van waarheid
 * (DB-rij app_settings.global), met defaults als fallback. Alle business-knoppen
 * — verzending, cutoffs, levertijd, express-toeslag, drempels,
 * veiligheidsvoorraad — staan hier en zijn via /account/instellingen te
 * bewerken. Env-vars dienen alleen nog als initiële default.
 *
 * Cache: 30s in-proces, zodat een wijziging snel doorwerkt zonder elke request
 * de DB te raken.
 */

export type Settings = {
  // Verzendkosten
  freeShippingCents: number;
  shippingCents: number;
  expressSurchargeCents: number;
  // Cutoffs (NL-tijd, uur)
  warehouseCutoffHour: number;
  storeCutoffHour: number;
  branchCutoffs: Record<string, number>;
  // Levertijd (werkdagen)
  standardMinDays: number;
  standardMaxDays: number;
  warehouseTransitDays: number; // magazijn → bezorging
  storeExtraDays: number; // extra dagen als (deels) uit winkel/split
  expressTransitDays: number; // bezorging bij snellere levering
  // Voorraad-bescherming
  retailSafetyStock: number;
  warehouseSafetyStock: number;
  protectUnderstockedRetail: boolean;
};

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export const DEFAULT_SETTINGS: Settings = {
  freeShippingCents: num(process.env.GENTS_FREE_SHIPPING_CENTS, 7500),
  shippingCents: num(process.env.GENTS_SHIPPING_CENTS, 495),
  expressSurchargeCents: num(process.env.GENTS_EXPRESS_SURCHARGE_CENTS, 150),
  warehouseCutoffHour: num(process.env.GENTS_WAREHOUSE_CUTOFF_HOUR, 16),
  storeCutoffHour: num(process.env.GENTS_STORE_CUTOFF_HOUR, 15),
  branchCutoffs: {},
  standardMinDays: num(process.env.GENTS_STANDARD_MIN_DAYS, 2),
  standardMaxDays: num(process.env.GENTS_STANDARD_MAX_DAYS, 3),
  warehouseTransitDays: 1,
  storeExtraDays: 1,
  expressTransitDays: 1,
  retailSafetyStock: num(process.env.GENTS_RETAIL_SAFETY_STOCK, 1),
  warehouseSafetyStock: num(process.env.GENTS_WAREHOUSE_SAFETY_STOCK, 0),
  protectUnderstockedRetail: (process.env.GENTS_PROTECT_UNDERSTOCKED ?? "1") !== "0",
};

let _cache: Settings | null = null;
let _at = 0;
const TTL = 30_000;

export async function getSettings(): Promise<Settings> {
  if (_cache && Date.now() - _at < TTL) return _cache;
  try {
    const db = getDb();
    const rows = await db.select().from(appSettings).where(eq(appSettings.id, "global")).limit(1);
    const stored = (rows[0]?.data ?? {}) as Partial<Settings>;
    _cache = { ...DEFAULT_SETTINGS, ...stored, branchCutoffs: { ...DEFAULT_SETTINGS.branchCutoffs, ...(stored.branchCutoffs || {}) } };
  } catch {
    _cache = DEFAULT_SETTINGS;
  }
  _at = Date.now();
  return _cache;
}

/** Werkt een deelverzameling instellingen bij (admin) en leegt de cache. */
export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const db = getDb();
  const current = await getSettings();
  const next: Settings = { ...current, ...patch };
  await db
    .insert(appSettings)
    .values({ id: "global", data: next, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: appSettings.id, set: { data: next, updatedAt: sql`now()` } });
  _cache = next;
  _at = Date.now();
  return next;
}

export function clearSettingsCache() {
  _cache = null;
  _at = 0;
}
