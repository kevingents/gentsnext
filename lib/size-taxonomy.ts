/**
 * Maat-taxonomie — exact overgenomen uit de Shopify-theme
 * (snippets/variant-picker.liquid). GENTS-confectiematen coderen pasvorm-lengte
 * in het getal:
 *   REGULAR  42–64 (even)   → XXS … 6XL
 *   LONG     88–118 (lengtematen)  → XS … 4XL
 *   SHORT    22–32 (kwartmaten)    → XS … 6XL
 * Overhemd-boordmaten dragen de lettermaat als eerste woord ("M 39/40"); een
 * "7"-suffix ("M7 39/40") = mouwlengte 7 (lang).
 *
 * Voor het FILTER collapsen we elke maat naar zijn lettermaat-rij, zodat de
 * facet ~10 nette buckets toont i.p.v. 44/46/25/98/One/S/M door elkaar.
 */

export type SizeGroup = "regular" | "long" | "short";
export type SizeLayout = "regular-long-short" | "extra-sleeve" | "regular-only";

/**
 * KLEDING-maten: lettermaten + de drie confectiereeksen die één-op-één op een
 * lettermaat-rij vallen. Bewust ZONDER boordmaten — die horen bij overhemden en
 * botsen met de pakkenreeks (zie BOORD_ROW_MAP).
 */
const CLOTHING_ROW_MAP: Record<string, string> = {
  XXS: "XXS", XS: "XS", S: "S", M: "M", "M/L": "M/L", L: "L", XL: "XL",
  XXL: "XXL", "3XL": "3XL", "4XL": "4XL", "5XL": "5XL", "6XL": "6XL",
  // REGULAR
  "42": "XXS", "44": "XS", "46": "S", "48": "M", "50": "M/L", "52": "L",
  "54": "XL", "56": "XXL", "58": "3XL", "60": "4XL", "62": "5XL", "64": "6XL",
  // LONG (lengtematen)
  "88": "XS", "90": "S", "94": "M", "98": "M/L", "102": "L", "106": "XL",
  "110": "XXL", "114": "3XL", "118": "4XL",
  // SHORT (kwartmaten)
  "22": "XS", "23": "S", "24": "M", "25": "M/L", "26": "L", "27": "XL",
  "28": "XXL", "29": "3XL", "30": "4XL", "31": "5XL", "32": "6XL",
};

/**
 * OVERHEMD-BOORDMATEN. Losse boordmaten stonden als eigen buckets in het
 * maatfilter (XS · M · XL · 36 · 39 · 41 · 43 …) — twee maatsystemen door
 * elkaar. Alleen de maten die NIET botsen met de pakken-reeks (42-64 even);
 * 42/44/46 blijven pakmaten, overhemden dragen daar toch "L 41/42"-labels.
 */
const BOORD_ROW_MAP: Record<string, string> = {
  "36": "XS", "37": "S", "38": "S", "39": "M", "40": "M",
  "41": "L", "43": "XL", "45": "XXL",
};

const ROW_MAP: Record<string, string> = { ...CLOTHING_ROW_MAP, ...BOORD_ROW_MAP };

export const ROW_ORDER = ["XXS", "XS", "S", "M", "M/L", "L", "XL", "XXL", "3XL", "4XL", "5XL", "6XL"];

const SLEEVE7 = /^[A-Z0-9/]+7$/;

export function sizeToken(value: string): string {
  return String(value || "").trim().split(" ")[0].trim().toUpperCase();
}

/** Lettermaat-rij (de filter-bucket) voor een maatwaarde. */
export function sizeRowLabel(value: string): string {
  const token = sizeToken(value);
  if (!token) return "";
  // Mouwlengte-7 variant ("M7","XL7","3XL7","S7 37/38") → lettermaat zonder de 7.
  if (token.length > 1 && token.endsWith("7")) {
    const base = token.slice(0, -1);
    if (ROW_MAP[base]) return ROW_MAP[base];
  }
  // Colbert met expliciete Long/Short-suffix ("44L","50S","54L") → lettermaat.
  const ls = token.match(/^(\d{2})[LS]$/);
  if (ls) {
    const n = parseInt(ls[1], 10);
    if (n >= 42 && n <= 64 && n % 2 === 0 && ROW_MAP[ls[1]]) return ROW_MAP[ls[1]];
  }
  return ROW_MAP[token] || token;
}

/** In welke kolom (regular/long/short) valt deze maat, gegeven de layout. */
export function sizeGroup(value: string, layout: SizeLayout): SizeGroup {
  const token = sizeToken(value);
  const num = parseInt(token, 10);
  if (layout === "extra-sleeve") {
    // Mouwlengte-7 = eindigt op 7 met een lettermaat-basis ("S7","3XL7").
    // NIET op parseInt leunen: parseInt("3XL7")=3 (geen NaN) → "3XL7" belandde
    // in de Regular-kolom; en puur-numerieke maten ("27") zijn géén mouwlengte.
    const base = token.slice(0, -1);
    if (SLEEVE7.test(token) && !/^\d+$/.test(token) && ROW_MAP[base]) return "long";
    return "regular";
  }
  if (layout === "regular-only") return "regular";
  if (!Number.isNaN(num)) {
    if (num >= 88 && num <= 118 && num % 2 === 0) return "long";
    if (num >= 22 && num <= 34) return "short";
  }
  return "regular";
}

const REGULAR_ONLY_HG = new Set([
  "truien", "poloshirts", "poloshirt", "schoenen", "shoes", "loafers", "sneakers", "veterschoenen", "laarzen",
  // Accessoires: platte matenlijst (geen Regular/Long/Short — die slaat nergens
  // op bij riemen/dassen; hun maten zijn cm-omtrek of "ONE", geen lichaamslengte).
  "riemen", "riem", "stropdassen", "strikken", "sokken", "bretels", "sjaal", "sjaals",
  "manchetknopen", "dasspelden", "pochet", "cumberband", "accessoires", "ondergoed", "boxershorts",
]);
const SLEEVE_HG = new Set(["overhemden", "shirts"]);

/** Bepaalt de maatlayout o.b.v. hoofdgroep + aanwezige maten (zoals de theme). */
export function sizeLayoutFor(hoofdgroep: string, sizes: string[]): SizeLayout {
  const hg = String(hoofdgroep || "").trim().toLowerCase();
  if (REGULAR_ONLY_HG.has(hg)) return "regular-only";
  if (SLEEVE_HG.has(hg)) return "extra-sleeve";
  let hasLong = false;
  let hasShort = false;
  for (const s of sizes) {
    const n = parseInt(sizeToken(s), 10);
    if (!Number.isNaN(n)) {
      if (n >= 88 && n <= 118) hasLong = true;
      if (n >= 22 && n <= 34) hasShort = true;
    }
  }
  return hasLong || hasShort ? "regular-long-short" : "regular-only";
}

/** Sorteersleutel voor lettermaat-buckets (XXS→6XL, dan One, dan overig). */
export function rowSortIndex(label: string): number {
  const i = ROW_ORDER.indexOf(label);
  if (i >= 0) return i;
  if (label === "ONE" || label.toUpperCase() === "ONE") return 100;
  return 200;
}

export function rowDisplayLabel(label: string): string {
  if (label.toUpperCase() === "ONE") return "Eén maat";
  return label;
}

/* ───────────────────────── Matensystemen (PLP-maatfilter) ─────────────────
 *
 * Het maatfilter toonde één platte rij met ZES matensystemen door elkaar:
 * lettermaten, boordmaten van overhemden, schoenmaten, riemmaten (cm),
 * sokmaten en losse confectiematen. Dat oogde niet alleen rommelig, het was
 * ook fout: schoenmaat 41 en overhemd-boordmaat 41 zijn hetzelfde GETAL maar
 * een totaal andere maat. Wie op "41" filterde kreeg overhemden mét schoenen.
 *
 * Daarom bepaalt het PRODUCT het matensysteem (hoofdgroep; alleen als die leeg
 * is een terugval op de titel) en draagt de filterwaarde het systeem mee:
 * "sc.41" (schoen) is iets anders dan "bo.41" (boordmaat). Het getal beslist
 * nooit zelf — binnen een systeem bepaalt de maat alleen nog de vorm
 * (bv. bij overhemden: een kaal getal = boordmaat, een letter = lettermaat).
 */

export type SizeSystem =
  | "kleding" | "boord" | "confectie" | "schoen" | "riem" | "sok" | "eenmaat" | "overig";

/** Weergavevolgorde van de subkopjes in het maatfilter. */
export const SIZE_SYSTEM_ORDER: SizeSystem[] = [
  "kleding", "boord", "confectie", "schoen", "riem", "sok", "eenmaat", "overig",
];

/** Korte code in de URL (`maat=bo.41`) — bewust kort, hij staat in gedeelde links. */
export const SIZE_SYSTEM_CODE: Record<SizeSystem, string> = {
  kleding: "kl", boord: "bo", confectie: "cf", schoen: "sc",
  riem: "ri", sok: "so", eenmaat: "on", overig: "ov",
};
const CODE_TO_SYSTEM: Record<string, SizeSystem> = Object.fromEntries(
  Object.entries(SIZE_SYSTEM_CODE).map(([sys, code]) => [code, sys as SizeSystem])
) as Record<string, SizeSystem>;

/** i18n-sleutel van het subkopje (NL-bron staat in lib/messages). */
export function sizeSystemKey(system: SizeSystem): string {
  return `plp.filters.sizeSystem.${system}`;
}

/**
 * Productfamilies die een EIGEN matensysteem hebben. De sleutel is de
 * hoofdgroep (kleingeschreven); alles wat hier niet in staat is "rest" —
 * gewone kleding dus.
 */
export const SIZE_FAMILY_NAMES: Record<"schoen" | "riem" | "sok" | "overhemd", string[]> = {
  schoen: ["schoenen", "shoes", "schoen", "loafers", "sneakers", "veterschoenen", "laarzen"],
  riem: ["riemen", "riem", "belts"],
  sok: ["sokken", "sok", "kousen", "socks"],
  overhemd: ["overhemden"],
};

/**
 * Terugval als een product GEEN hoofdgroep heeft (losse Shopify-producten
 * zonder SRS-velden): herken de familie aan de titel. Wordt ook in SQL gebruikt
 * (lib/catalog) — daarom een kale patroonstring, zonder flags.
 */
export const SIZE_FAMILY_TITLE_PATTERNS: { family: string; sql: string }[] = [
  { family: "schoenen", sql: "schoen|loafer|sneaker|veter|laars|derby|oxford|brogue|instapper|mocassin" },
  { family: "riemen", sql: "riem|belt" },
  { family: "sokken", sql: "sok|kous" },
];

type FamilyClass = "schoen" | "riem" | "sok" | "overhemd" | "rest";
/** Alle familieklassen, met per klasse één representatieve hoofdgroep. */
const FAMILY_REPRESENTATIVE: Record<FamilyClass, string> = {
  schoen: "schoenen", riem: "riemen", sok: "sokken", overhemd: "overhemden", rest: "",
};
const FAMILY_CLASSES = Object.keys(FAMILY_REPRESENTATIVE) as FamilyClass[];

function familyClass(family: string): FamilyClass {
  const f = String(family || "").trim().toLowerCase();
  if (!f) return "rest";
  for (const cls of ["schoen", "riem", "sok", "overhemd"] as const) {
    if (SIZE_FAMILY_NAMES[cls].includes(f)) return cls;
  }
  return "rest";
}

const ONE_TOKENS = ["ONE", "ONESIZE", "ONE-SIZE"];

/** Lettermaat-rij van een KLEDING-maat (dus zonder boordmaten). "" = geen. */
function clothingRowLabel(token: string): string {
  const tok = String(token || "").trim().toUpperCase();
  if (!tok) return "";
  if (CLOTHING_ROW_MAP[tok]) return CLOTHING_ROW_MAP[tok];
  // Mouwlengte-7 ("M7", "3XL7") valt op dezelfde rij als de basis-lettermaat.
  // Puur-numerieke maten die toevallig op 7 eindigen ("27") vallen hierbuiten.
  if (tok.length > 1 && tok.endsWith("7") && !/^\d+$/.test(tok)) {
    const base = tok.slice(0, -1);
    if (!/^\d+$/.test(base) && CLOTHING_ROW_MAP[base]) return CLOTHING_ROW_MAP[base];
  }
  return "";
}

/** Alle rauwe maat-tokens die op deze kleding-rij uitkomen (voor de filterquery). */
function clothingTokensForRow(row: string): string[] {
  const out = Object.entries(CLOTHING_ROW_MAP).filter(([, r]) => r === row).map(([t]) => t);
  for (const t of [...out]) if (!/^\d+$/.test(t)) out.push(`${t}7`);
  return out;
}

/**
 * Token → lettermaat-rij, als platte lijst. De facet-query gebruikt dit als
 * ONTDUBBEL-sleutel: een pantalon met zowel maat 52 (regular) als 102 (lang)
 * is één product in de rij "L" en mag daar niet dubbel geteld worden.
 */
export const CLOTHING_ROW_PAIRS: [string, string][] = (() => {
  const pairs: [string, string][] = Object.entries(CLOTHING_ROW_MAP);
  for (const [tok, row] of [...pairs]) if (!/^\d+$/.test(tok)) pairs.push([`${tok}7`, row]);
  return pairs;
})();

/**
 * Matensysteem + weergavewaarde van één maat, bepaald vanuit het product.
 * `family` = hoofdgroep (of de titel-terugval), `rawSize` = de maat zoals de
 * bron 'm levert ("L 41/42", "41", "39-42", "One").
 */
export function sizeFacetFor(family: string, rawSize: string): { system: SizeSystem; value: string } | null {
  const tok = sizeToken(rawSize);
  if (!tok) return null;
  if (ONE_TOKENS.includes(tok)) return { system: "eenmaat", value: "ONE" };

  const fam = familyClass(family);
  if (fam === "schoen") return { system: "schoen", value: tok };
  if (fam === "riem") return { system: "riem", value: tok };
  if (fam === "sok") return { system: "sok", value: tok };
  // Overhemd met een KAAL getal = boordmaat (Blumfontain e.d.). Een overhemd
  // met een lettermaat ("L 41/42") is gewoon kleding — dezelfde rij als een trui.
  if (fam === "overhemd" && /^\d{2}$/.test(tok)) {
    const n = Number(tok);
    if (n >= 30 && n <= 50) return { system: "boord", value: tok };
  }

  const row = clothingRowLabel(tok);
  if (row) return { system: "kleding", value: row };
  // Blijft over: confectiematen die niet op een lettermaat-rij vallen —
  // dames-maten (34/36/38 + 38L/40L), kwartmaten 33, rokvest 1/2.
  if (/^\d/.test(tok)) return { system: "confectie", value: tok };
  return { system: "overig", value: tok };
}

/** Facet-waarde zoals hij in de URL staat: `<systeemcode>.<maat>`. */
export function sizeFacetKey(f: { system: SizeSystem; value: string }): string {
  return `${SIZE_SYSTEM_CODE[f.system]}.${f.value}`;
}

/** Leest `bo.41` terug; null = kale (oude) waarde zoals `41` of `M/L`. */
export function parseSizeFacetKey(value: string): { system: SizeSystem; value: string } | null {
  const v = String(value || "");
  const dot = v.indexOf(".");
  if (dot <= 0) return null;
  const system = CODE_TO_SYSTEM[v.slice(0, dot)];
  const rest = v.slice(dot + 1);
  return system && rest ? { system, value: rest } : null;
}

/** Sorteert binnen één systeem: lettermaten in natuurlijke volgorde, getallen numeriek. */
export function compareSizeValues(a: string, b: string): number {
  const ia = ROW_ORDER.indexOf(a);
  const ib = ROW_ORDER.indexOf(b);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, "nl", { numeric: true });
}

/**
 * Vertaalslag naar de filterquery. Per familieklasse de rauwe maat-tokens die
 * op deze facet-waarde uitkomen; `alle` = geen familie-eis nodig.
 * Wordt afgeleid uít sizeFacetFor, zodat filter en facet nooit uit elkaar lopen.
 * Retourneert null bij een kale (oude) waarde — die krijgt bewust brede match.
 */
export type SizeFilterBranch = { famClass: FamilyClass | "alle"; tokens: string[] };

export function sizeFilterBranches(facetValue: string): SizeFilterBranch[] | null {
  const parsed = parseSizeFacetKey(facetValue);
  if (!parsed) return null;
  const candidates =
    parsed.system === "kleding" ? clothingTokensForRow(parsed.value)
    : parsed.system === "eenmaat" ? [...ONE_TOKENS]
    : [parsed.value];

  const branches: SizeFilterBranch[] = [];
  for (const cls of FAMILY_CLASSES) {
    const rep = FAMILY_REPRESENTATIVE[cls];
    const tokens = candidates.filter((tok) => {
      const hit = sizeFacetFor(rep, tok);
      return hit != null && hit.system === parsed.system && hit.value === parsed.value;
    });
    if (tokens.length) branches.push({ famClass: cls, tokens });
  }
  if (!branches.length) return [];
  // Geldt het voor élke familie met dezelfde tokens? Dan is de familie-eis
  // overbodig (bv. "Eén maat") — scheelt een hoop OR's in de query.
  const first = branches[0].tokens.join("|");
  const overal = branches.length === FAMILY_CLASSES.length && branches.every((b) => b.tokens.join("|") === first);
  return overal ? [{ famClass: "alle", tokens: branches[0].tokens }] : branches;
}
