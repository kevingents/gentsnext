/**
 * Wat past bij wat — de regels achter "Maak de look compleet".
 *
 * Losse .js met alleen pure functies, zodat `node --test` ze kan draaien
 * (zelfde patroon als lib/veiligheidsvoorraad-regels.js).
 *
 * De oude versie keek alléén naar de hoofdgroep. Bij LAKSCHOENEN kwam je zo uit
 * op `Schoenen: ["Riemen", "Sokken"]` en kreeg de klant een riem en turquoise
 * sokken aangeboden — bij een schoen die je uitsluitend op black tie draagt.
 * Twee dingen misten:
 *
 *  1. De SUBGROEP. Een lakschoen is een andere aankoop dan een veterschoen;
 *     een smokingoverhemd iets anders dan een businesshemd.
 *  2. De GELEGENHEID. Bij black tie hoort geen riem (de broek heeft een
 *     verstelband of bretels) en geen vrolijke kleur.
 */

/** @type {Record<string, string[]>} Categorie-regels op hoofdgroep (de brede terugval). */
export const CROSS_SELL = {
  Pakken: ["Overhemden", "Stropdassen", "Schoenen", "Pochet"],
  Colberts: ["Overhemden", "Stropdassen", "Pochet"],
  Broeken: ["Riemen", "Overhemden", "Schoenen"],
  Overhemden: ["Stropdassen", "Manchetknopen", "Colberts"],
  Stropdassen: ["Pochet", "Overhemden", "Dasspelden"],
  Strikken: ["Pochet", "Overhemden", "Manchetknopen"],
  Gilets: ["Overhemden", "Stropdassen"],
  Schoenen: ["Riemen", "Sokken"],
  Truien: ["Overhemden", "Broeken"],
  "Polo-shirts": ["Broeken", "Riemen"],
};

export const DEFAULT_CROSS = ["Overhemden", "Stropdassen", "Pochet"];

/**
 * Fijnere regels op "hoofdgroep|subgroep". Staat er niets, dan geldt de
 * hoofdgroep-regel hierboven.
 * @type {Record<string, string[]>}
 */
export const CROSS_SELL_SUB = {
  // Black tie: strik, pochet, manchetknopen en een cummerbund-vervanger.
  // Nadrukkelijk GEEN riem — die hoort niet bij een smokingbroek.
  "Schoenen|Lakschoenen": ["Strikken", "Pochet", "Manchetknopen", "Sokken"],
  "Overhemden|Smoking": ["Strikken", "Manchetknopen", "Pochet", "Colberts"],
  "Overhemden|Rokkostuum": ["Strikken", "Manchetknopen", "Gilets"],
  "Colberts|Smoking": ["Overhemden", "Strikken", "Schoenen", "Manchetknopen"],
  "Colberts|Rokkostuum": ["Overhemden", "Strikken", "Gilets", "Schoenen"],
  "Broeken|Smoking": ["Overhemden", "Strikken", "Schoenen", "Bretels"],
  "Gilets|Rokkostuum": ["Overhemden", "Strikken", "Colberts"],
  // Loafers draag je zonder veters en vaak zonder sok-statement: riem + broek.
  "Schoenen|Loafers": ["Riemen", "Broeken", "Sokken"],
  "Schoenen|Sneakers": ["Broeken", "Truien", "Sokken"],
  // Een businessoverhemd vraagt om das/colbert, niet om een strik.
  "Overhemden|Overshirt": ["Broeken", "Truien", "Schoenen"],
};

/** Subgroepen die een formele (black tie / white tie) gelegenheid betekenen. */
const FORMELE_SUBGROEPEN = new Set(["smoking", "rokkostuum", "lakschoenen", "jacquet"]);

/**
 * Is dit artikel gebonden aan een formele dresscode? Dan mogen er geen vrolijke
 * kleuren en geen riem bij. `attrs` = de product-attributen (SRS zet `smoking`
 * en `rokkostuum` als eigen veld op de artikelen die daarbij horen).
 *
 * @param {string} hoofdgroep
 * @param {string} subgroep
 * @param {Record<string, unknown>} [attrs]
 * @returns {boolean}
 */
export function isFormeel(hoofdgroep, subgroep, attrs = {}) {
  if (FORMELE_SUBGROEPEN.has(String(subgroep || "").trim().toLowerCase())) return true;
  const ja = (v) => String(v ?? "").trim().toLowerCase() === "ja";
  return ja(attrs.smoking) || ja(attrs.rokkostuum);
}

/** Kleuren die bij black tie / white tie kunnen. Alles daarbuiten valt af. */
export const FORMELE_KLEUREN = ["zwart", "wit", "grijs"];

/**
 * De doelcategorieën voor dit product, meest passend eerst.
 * Bij een formeel artikel valt "Riemen" er sowieso uit — ook als de
 * hoofdgroep-regel hem noemt.
 *
 * @param {string} hoofdgroep
 * @param {string} subgroep
 * @param {Record<string, unknown>} [attrs]
 * @returns {string[]}
 */
export function crossSellDoelen(hoofdgroep, subgroep, attrs = {}) {
  const hg = String(hoofdgroep || "");
  const sg = String(subgroep || "");
  const doelen = CROSS_SELL_SUB[`${hg}|${sg}`] ?? CROSS_SELL[hg] ?? DEFAULT_CROSS;
  return isFormeel(hg, sg, attrs) ? doelen.filter((d) => d !== "Riemen") : [...doelen];
}
