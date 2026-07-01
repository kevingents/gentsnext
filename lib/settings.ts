import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { DEFAULT_SYNONYMS } from "@/lib/search-helpers";

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
  /** Per-weekdag cutoff (NL-dagnaam → uur); overschrijft het basisuur op die dag.
   *  Bv. magazijn verzendt op vrijdag tot 16:00, winkels tot 17:00. */
  warehouseCutoffByDay: Record<string, number>;
  storeCutoffByDay: Record<string, number>;
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
  // Doorloop/overstock-routing: verzend bij voorkeur uit een winkel die ruim boven
  // z'n ideaal zit (trage/oude schapvoorraad eerst weg). minSurplus = drempel in
  // stuks waarboven een winkel zelfs vóór het magazijn mag gaan. Default uit.
  routeOverstockFirst: { enabled: boolean; minSurplus: number };
  // Zoeken
  searchSynonyms: string; // één groep per regel, komma-gescheiden
  // Shop-the-look op AI-modelfoto's: de vaste basis-outfit die het canvas-model
  // draagt (wit overhemd, zand pantalon, cognac derby). Per modelfoto wordt het
  // getoonde product hieraan toegevoegd → klikbare, shoppbare outfit op de PDP.
  modelLook: {
    enabled: boolean;
    minStock: number; // drempel "goed op voorraad" voor de slimme look-substitutie
    items: { handle: string; label: string; hoofdgroep: string; x: number; y: number }[];
  };
  // Cadeaubonnen: aan/uit, voorgestelde bedragen, grenzen voor een vrij bedrag,
  // en geldigheidsduur (maanden). Bedragen in centen.
  giftcardConfig: {
    enabled: boolean;
    presetAmountsCents: number[];
    minCents: number;
    maxCents: number;
    validityMonths: number;
  };
  // Staffelkorting: vanaf X artikelen Y% korting op het subtotaal. Default uit.
  tieredDiscount: {
    enabled: boolean;
    minItems: number;
    percentOff: number;
  };
  // Retouren: bedenktijd, retourkosten bij geld-terug (DHL-label), en of store
  // credit / omruilen altijd een gratis retour geeft.
  returnConfig: {
    windowDays: number;
    dhlReturnCostCents: number;
    freeOnCredit: boolean;
    // Signaal-drempels: een artikel is een "aandachtspunt" als het ≥ minReturns keer
    // terugkomt, ≥ minRatePct van het verkochte aantal, en gemiddeld ≤ fastDays na bestelling.
    signalMinReturns: number;
    signalMinRatePct: number;
    signalFastDays: number;
  };
  // Spaarpunten: na hoeveel dagen na BETALING verdiende punten besteedbaar worden
  // (vesting). Dekt de retourperiode, zodat een retour binnen het venster geen
  // terugvordering / negatief saldo geeft — de punten staan tot dan "in behandeling".
  loyaltyConfig: {
    vestingDays: number;
    /** Inwisselkoers: centen tegoedbon per punt (5 = 500 punten → € 25). */
    redeemCentsPerPoint: number;
    /** Minimaal in te wisselen punten. */
    redeemMinPoints: number;
    /** Inwisselen per veelvoud (0 = vrij bedrag). */
    redeemStepPoints: number;
    /** Geldigheid van de ingewisselde tegoedbon (dagen). */
    redeemVoucherDays: number;
  };
};

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export const DEFAULT_SETTINGS: Settings = {
  freeShippingCents: num(process.env.GENTS_FREE_SHIPPING_CENTS, 7500),
  shippingCents: num(process.env.GENTS_SHIPPING_CENTS, 495),
  expressSurchargeCents: num(process.env.GENTS_EXPRESS_SURCHARGE_CENTS, 150),
  // Basisuur = "einde dag" (geen vroege cutoff); de bindende cutoff zit in de
  // per-weekdag-override hieronder (magazijn vrijdag 16:00, winkels vrijdag 17:00).
  warehouseCutoffHour: num(process.env.GENTS_WAREHOUSE_CUTOFF_HOUR, 23),
  storeCutoffHour: num(process.env.GENTS_STORE_CUTOFF_HOUR, 23),
  branchCutoffs: {},
  warehouseCutoffByDay: { vrijdag: 16 },
  storeCutoffByDay: { vrijdag: 17 },
  standardMinDays: num(process.env.GENTS_STANDARD_MIN_DAYS, 2),
  standardMaxDays: num(process.env.GENTS_STANDARD_MAX_DAYS, 3),
  warehouseTransitDays: 1,
  storeExtraDays: 1,
  expressTransitDays: 1,
  retailSafetyStock: num(process.env.GENTS_RETAIL_SAFETY_STOCK, 2),
  warehouseSafetyStock: num(process.env.GENTS_WAREHOUSE_SAFETY_STOCK, 0),
  protectUnderstockedRetail: (process.env.GENTS_PROTECT_UNDERSTOCKED ?? "1") !== "0",
  routeOverstockFirst: { enabled: false, minSurplus: 3 },
  searchSynonyms: DEFAULT_SYNONYMS,
  modelLook: {
    enabled: true,
    minStock: 8,
    items: [
      { handle: "overhemd-nos-wit", label: "Overhemd", hoofdgroep: "Overhemden", x: 50, y: 21 },
      { handle: "pantalon-stretchkatoen-zand", label: "Pantalon", hoofdgroep: "Broeken", x: 50, y: 71 },
      { handle: "cognac-cap-toe", label: "Schoenen", hoofdgroep: "Schoenen", x: 50, y: 94 },
    ],
  },
  giftcardConfig: {
    enabled: true,
    presetAmountsCents: [2500, 5000, 10000, 15000],
    minCents: 1000,
    maxCents: 50000,
    validityMonths: 24,
  },
  tieredDiscount: { enabled: false, minItems: 2, percentOff: 10 },
  returnConfig: {
    windowDays: num(process.env.GENTS_RETURN_WINDOW_DAYS, 14),
    dhlReturnCostCents: num(process.env.GENTS_RETURN_DHL_COST_CENTS, 499), // S-pakket heenzending, ex toeslagen (eigen DHL-contract)
    freeOnCredit: (process.env.GENTS_RETURN_FREE_ON_CREDIT ?? "1") !== "0",
    signalMinReturns: num(process.env.GENTS_RETURN_SIGNAL_MIN, 3),
    signalMinRatePct: num(process.env.GENTS_RETURN_SIGNAL_RATE, 30),
    signalFastDays: num(process.env.GENTS_RETURN_SIGNAL_FAST_DAYS, 7),
  },
  loyaltyConfig: {
    vestingDays: num(process.env.GENTS_LOYALTY_VESTING_DAYS, 21),
    redeemCentsPerPoint: num(process.env.GENTS_LOYALTY_REDEEM_CENTS_PER_POINT, 5), // 500 punten = € 25
    redeemMinPoints: num(process.env.GENTS_LOYALTY_REDEEM_MIN_POINTS, 500),
    redeemStepPoints: num(process.env.GENTS_LOYALTY_REDEEM_STEP_POINTS, 500),
    redeemVoucherDays: num(process.env.GENTS_LOYALTY_REDEEM_VOUCHER_DAYS, 365),
  },
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
    _cache = {
      ...DEFAULT_SETTINGS,
      ...stored,
      branchCutoffs: { ...DEFAULT_SETTINGS.branchCutoffs, ...(stored.branchCutoffs || {}) },
      warehouseCutoffByDay: { ...DEFAULT_SETTINGS.warehouseCutoffByDay, ...(stored.warehouseCutoffByDay || {}) },
      storeCutoffByDay: { ...DEFAULT_SETTINGS.storeCutoffByDay, ...(stored.storeCutoffByDay || {}) },
      modelLook: { ...DEFAULT_SETTINGS.modelLook, ...(stored.modelLook || {}) },
      giftcardConfig: { ...DEFAULT_SETTINGS.giftcardConfig, ...(stored.giftcardConfig || {}) },
      tieredDiscount: { ...DEFAULT_SETTINGS.tieredDiscount, ...(stored.tieredDiscount || {}) },
      returnConfig: { ...DEFAULT_SETTINGS.returnConfig, ...(stored.returnConfig || {}) },
      routeOverstockFirst: { ...DEFAULT_SETTINGS.routeOverstockFirst, ...(stored.routeOverstockFirst || {}) },
    };
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
