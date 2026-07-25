/**
 * Leidt schone Materiaal- + Onderhoud(care)-blokken af uit de SRS-productdata.
 * `samenstelling_materiaal` is netjes parseerbaar; `wasvoorschrift` is rijke,
 * rommelige tekst (emoji's + symbolen) waaruit we via trefwoorden de standaard
 * wasvoorschrift-symbolen halen. Geen emoji's in de UI — de component rendert
 * SVG-iconen op basis van de `key`.
 */

/**
 * Strip emoji's + was-/strijk-symbolen uit SRS-tekst (no-emoji-regel in de UI).
 * Dekt emoji-blokken, pijlen, technische/geometrische symbolen, variation-selectors
 * en ZWJ, plus de losse symbolen die SRS gebruikt (△◯▭♨Ⓟ•|).
 */
const SYMBOL_RE =
  /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{25A0}-\u{25FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}△◯▭♨Ⓟⓕ•|]/gu;
export function stripSymbols(s: string | undefined | null): string {
  return String(s || "").replace(SYMBOL_RE, " ").replace(/\s+/g, " ").replace(/^[\s·,-]+/, "").trim();
}

export type Composition = { pct: number; material: string };
export type CareKey =
  | "wash30" | "wash40" | "wash60" | "handwash" | "nowash"
  | "nobleach"
  | "notumble" | "tumblelow"
  | "dryflat" | "dryline" | "nowring"
  | "noiron" | "ironlow" | "ironmid"
  | "dryclean";
/**
 * `label` = de Nederlandse brontekst (vangnet), `labelKey` = de sleutel in de
 * vertaalrail. Het Onderhoud-blok stond onder een Engelse/Duitse kop nog vol
 * Nederlandse labels; de UI rendert daarom via careLabel(item, t).
 */
export type CareItem = { key: CareKey; label: string; labelKey: string };

/** Locale-gebonden vertaalfunctie (uit getT(locale) — de locale zit dus in `t`). */
export type CareTranslate = (key: string) => string;

/**
 * t() geeft de sleutel zélf terug zolang die nog niet in de catalogus staat.
 * In dat geval tonen we de Nederlandse brontekst i.p.v. "care.label.wash30".
 */
export function trOr(t: CareTranslate | undefined, key: string, nl: string): string {
  const v = t?.(key);
  return v && v !== key ? v : nl;
}

/** "Polyester 58%, Viscose 25%, Wol 15%" of "100% Katoen" → [{pct, material}]. */
export function parseComposition(raw: string | undefined | null): Composition[] {
  const s = String(raw || "").trim();
  if (!s) return [];
  const out: Composition[] = [];
  for (const part of s.split(/[,;•]+/)) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/(\d{1,3})\s*%/);
    if (!m) continue;
    const pct = Number(m[1]);
    const material = p.replace(/\d{1,3}\s*%/, "").replace(/[^A-Za-zÀ-ÿ /-]/g, " ").replace(/\s+/g, " ").trim();
    if (material && pct > 0 && pct <= 100) out.push({ pct, material: titleCase(material) });
  }
  // Hoogste percentage eerst.
  return out.sort((a, b) => b.pct - a.pct);
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Vezelnamen uit SRS zijn Nederlands ("Katoen", "Scheerwol") en stonden zo ook
 * onder de Engelse kop "Material". Alleen de namen die écht anders zijn in een
 * andere taal staan hier; onbekende/samengestelde namen tonen we ongewijzigd.
 */
const MATERIAL_LABELS: Record<string, { key: string; nl: string }> = {
  wol: { key: "material.wol", nl: "Wol" },
  scheerwol: { key: "material.scheerwol", nl: "Scheerwol" },
  lamswol: { key: "material.lamswol", nl: "Lamswol" },
  merino: { key: "material.merino", nl: "Merino" },
  kasjmier: { key: "material.kasjmier", nl: "Kasjmier" },
  katoen: { key: "material.katoen", nl: "Katoen" },
  zijde: { key: "material.zijde", nl: "Zijde" },
  linnen: { key: "material.linnen", nl: "Linnen" },
  leer: { key: "material.leer", nl: "Leer" },
  leder: { key: "material.leder", nl: "Leder" },
  suède: { key: "material.suede", nl: "Suède" },
  suede: { key: "material.suede", nl: "Suède" },
  elastaan: { key: "material.elastaan", nl: "Elastaan" },
  acryl: { key: "material.acryl", nl: "Acryl" },
  bamboe: { key: "material.bamboe", nl: "Bamboe" },
};

/** Vezelnaam in de taal van `t`; onbekende namen blijven staan zoals ze zijn. */
export function materialLabel(name: string, t?: CareTranslate): string {
  const hit = MATERIAL_LABELS[name.trim().toLowerCase()];
  return hit ? trOr(t, hit.key, hit.nl) : name;
}

export type MaterialCat =
  | "wol" | "kasjmier" | "katoen" | "zijde" | "linnen" | "leer"
  | "polyester" | "viscose" | "elastaan" | "nylon" | "acryl" | "overig";

/** Materiaalcategorie voor het icoon — fijnmazig zodat elke vezel een eigen symbool krijgt. */
export function materialCategory(name: string): MaterialCat {
  const n = name.toLowerCase();
  if (/(merino|lamswol|wol\b|wool|alpaca|mohair|scheerwol)/.test(n)) return "wol";
  if (/(kasjmier|kasjmir|cashmere)/.test(n)) return "kasjmier";
  if (/(katoen|cotton|bamboe|denim)/.test(n)) return "katoen";
  if (/(zijde|silk)/.test(n)) return "zijde";
  if (/(linnen|linen|vlas)/.test(n)) return "linnen";
  if (/(leer|leder|suède|suede|nubuck)/.test(n)) return "leer";
  if (/(elasta|spandex|lycra)/.test(n)) return "elastaan";
  if (/(viscose|vicose|rayon|modal|lyocell|tencel)/.test(n)) return "viscose";
  if (/(nylon|polyamide)/.test(n)) return "nylon";
  if (/(acryl|polyacryl)/.test(n)) return "acryl";
  if (/(polyester|polyster|poly\b)/.test(n)) return "polyester";
  return "overig";
}

/**
 * Labeltekst per care-symbool met de bijbehorende sleutel in de vertaalrail.
 * `easycare` deelt het strijk-icoon (ironlow) maar heeft een eigen tekst.
 */
const CARE_LABELS = {
  handwash: { key: "care.label.handwash", nl: "Handwas" },
  nowash: { key: "care.label.nowash", nl: "Niet wassen" },
  wash60: { key: "care.label.wash60", nl: "Wassen 60°C" },
  wash40: { key: "care.label.wash40", nl: "Wassen 40°C" },
  wash30: { key: "care.label.wash30", nl: "Wassen 30°C" },
  nobleach: { key: "care.label.nobleach", nl: "Niet bleken" },
  notumble: { key: "care.label.notumble", nl: "Niet in de droger" },
  tumblelow: { key: "care.label.tumblelow", nl: "Droger lage temp." },
  dryflat: { key: "care.label.dryflat", nl: "Liggend drogen" },
  dryline: { key: "care.label.dryline", nl: "Aan de lijn drogen" },
  nowring: { key: "care.label.nowring", nl: "Niet uitknijpen" },
  noiron: { key: "care.label.noiron", nl: "Niet strijken" },
  ironmid: { key: "care.label.ironmid", nl: "Strijken middelhoog" },
  ironlow: { key: "care.label.ironlow", nl: "Strijken lage temp." },
  easycare: { key: "care.label.easycare", nl: "Strijkvrij — nauwelijks strijken" },
  dryclean: { key: "care.label.dryclean", nl: "Professioneel reinigen" },
} as const satisfies Record<string, { key: string; nl: string }>;
type CareLabelId = keyof typeof CARE_LABELS;

/** Vertaald label voor één care-item; valt terug op de NL-brontekst. */
export function careLabel(item: CareItem, t?: CareTranslate): string {
  return trOr(t, item.labelKey, item.label);
}

/** Leidt de belangrijkste care-symbolen af uit het wasvoorschrift + attributen. */
export function parseCare(wasvoorschrift: string | undefined | null, attrs?: Record<string, unknown>): CareItem[] {
  const t = String(wasvoorschrift || "").toLowerCase();
  const items: CareItem[] = [];
  const add = (key: CareKey, id: CareLabelId) => {
    if (!items.some((i) => i.key === key)) items.push({ key, label: CARE_LABELS[id].nl, labelKey: CARE_LABELS[id].key });
  };
  const has = (re: RegExp) => re.test(t);
  const drycleanOnly = has(/niet (in de )?(machine|hand)|was (leer|suède|suede) niet|stomerij|professioneel reinig|chemisch reinig/) && !has(/\b(30|40|60)\s*°/);

  // Wassen
  if (has(/handwas|met de hand was|was.*met de hand/)) add("handwash", "handwash");
  else if (drycleanOnly) add("nowash", "nowash");
  else if (has(/\b60\s*°/)) add("wash60", "wash60");
  else if (has(/\b40\s*°/)) add("wash40", "wash40");
  else if (has(/\b30\s*°/)) add("wash30", "wash30");

  // Bleken
  if (has(/niet bleken|geen (chloor|bleek)|bleek niet|△\s*[x✕✗]/)) add("nobleach", "nobleach");

  // Drogen (trommel)
  if (has(/niet in de droger|geen (was)?droger|niet (machinaal|trommel) droog|◯\s*[x✕✗]|🌀\s*[x✕✗]/)) add("notumble", "notumble");
  else if (has(/lage (temperatuur|stand).*droger|droger.*laag|trommeldrogen laag|drogen op lage/)) add("tumblelow", "tumblelow");

  // Drogen (vorm)
  if (has(/plat (te )?drogen|liggend drogen|plat liggend|plat op/)) add("dryflat", "dryflat");
  else if (has(/aan de lijn|lijn drogen|hang.*drogen|aan de lucht drogen/)) add("dryline", "dryline");
  if (has(/niet (uit)?wringen|niet uitknijpen|niet hard uitknijpen/)) add("nowring", "nowring");

  // Strijken
  if (has(/niet strijken|strijk.*niet|♨️?\s*[x✕✗]/)) add("noiron", "noiron");
  else if (has(/middel(warm|hoog|hoge)|150\s*°|2 stip/)) add("ironmid", "ironmid");
  else if (has(/lage temp.*strijk|strijk.*lage|1 stip|110\s*°|laag strijk/)) add("ironlow", "ironlow");

  // Stomerij
  if (has(/stomerij|professioneel reinig|chemisch reinig|\bⓟ\b/)) add("dryclean", "dryclean");

  // Fallback als het wasvoorschrift geen symbolen oplevert: leid af uit materiaal + categorie.
  if (!items.length) {
    const mat = String(attrs?.materiaal ?? "").toLowerCase();
    const hg = String(attrs?.hoofdgroep_omschrijving ?? "").toLowerCase();
    const both = `${mat} ${hg}`;
    if (/leer|leder|suède|suede|nubuck/.test(mat)) {
      add("nowash", "nowash");
      add("dryclean", "dryclean");
    } else if (/pak|colbert|smoking|gilet|jacquet|rok|wol|kasjmier|zijde/.test(both)) {
      add("dryclean", "dryclean");
      add("notumble", "notumble");
      add("ironlow", "ironlow");
    } else if (String(attrs?.strijkvrij ?? "").toLowerCase() === "ja") {
      add("ironlow", "easycare");
      add("wash30", "wash30");
    } else {
      add("wash30", "wash30");
      add("nobleach", "nobleach");
      add("ironlow", "ironlow");
    }
  }
  return items.slice(0, 6);
}

/** De prozatekst uit het wasvoorschrift, ontdaan van markdown-kop + symboolregels. */
export function careProse(wasvoorschrift: string | undefined | null): string[] {
  const s = String(wasvoorschrift || "");
  if (!s) return [];
  return s
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/^#+\s/.test(l) && !/^\[/.test(l)) // koppen + symbool-only regels eruit
    .filter((l) => /[a-z]{4,}/i.test(l) && l.length > 30) // alleen echte zinnen
    .map((l) => stripSymbols(l))
    .filter(Boolean);
}
