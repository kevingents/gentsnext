/**
 * Leidt schone Materiaal- + Onderhoud(care)-blokken af uit de SRS-productdata.
 * `samenstelling_materiaal` is netjes parseerbaar; `wasvoorschrift` is rijke,
 * rommelige tekst (emoji's + symbolen) waaruit we via trefwoorden de standaard
 * wasvoorschrift-symbolen halen. Geen emoji's in de UI — de component rendert
 * SVG-iconen op basis van de `key`.
 */

export type Composition = { pct: number; material: string };
export type CareKey =
  | "wash30" | "wash40" | "wash60" | "handwash" | "nowash"
  | "nobleach"
  | "notumble" | "tumblelow"
  | "dryflat" | "dryline" | "nowring"
  | "noiron" | "ironlow" | "ironmid"
  | "dryclean";
export type CareItem = { key: CareKey; label: string };

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

/** Leidt de belangrijkste care-symbolen af uit het wasvoorschrift + attributen. */
export function parseCare(wasvoorschrift: string | undefined | null, attrs?: Record<string, unknown>): CareItem[] {
  const t = String(wasvoorschrift || "").toLowerCase();
  const items: CareItem[] = [];
  const add = (key: CareKey, label: string) => {
    if (!items.some((i) => i.key === key)) items.push({ key, label });
  };
  const has = (re: RegExp) => re.test(t);
  const drycleanOnly = has(/niet (in de )?(machine|hand)|was (leer|suède|suede) niet|stomerij|professioneel reinig|chemisch reinig/) && !has(/\b(30|40|60)\s*°/);

  // Wassen
  if (has(/handwas|met de hand was|was.*met de hand/)) add("handwash", "Handwas");
  else if (drycleanOnly) add("nowash", "Niet wassen");
  else if (has(/\b60\s*°/)) add("wash60", "Wassen 60°C");
  else if (has(/\b40\s*°/)) add("wash40", "Wassen 40°C");
  else if (has(/\b30\s*°/)) add("wash30", "Wassen 30°C");

  // Bleken
  if (has(/niet bleken|geen (chloor|bleek)|bleek niet|△\s*[x✕✗]/)) add("nobleach", "Niet bleken");

  // Drogen (trommel)
  if (has(/niet in de droger|geen (was)?droger|niet (machinaal|trommel) droog|◯\s*[x✕✗]|🌀\s*[x✕✗]/)) add("notumble", "Niet in de droger");
  else if (has(/lage (temperatuur|stand).*droger|droger.*laag|trommeldrogen laag|drogen op lage/)) add("tumblelow", "Droger lage temp.");

  // Drogen (vorm)
  if (has(/plat (te )?drogen|liggend drogen|plat liggend|plat op/)) add("dryflat", "Liggend drogen");
  else if (has(/aan de lijn|lijn drogen|hang.*drogen|aan de lucht drogen/)) add("dryline", "Aan de lijn drogen");
  if (has(/niet (uit)?wringen|niet uitknijpen|niet hard uitknijpen/)) add("nowring", "Niet uitknijpen");

  // Strijken
  if (has(/niet strijken|strijk.*niet|♨️?\s*[x✕✗]/)) add("noiron", "Niet strijken");
  else if (has(/middel(warm|hoog|hoge)|150\s*°|2 stip/)) add("ironmid", "Strijken middelhoog");
  else if (has(/lage temp.*strijk|strijk.*lage|1 stip|110\s*°|laag strijk/)) add("ironlow", "Strijken lage temp.");

  // Stomerij
  if (has(/stomerij|professioneel reinig|chemisch reinig|\bⓟ\b/)) add("dryclean", "Professioneel reinigen");

  // Fallback als het wasvoorschrift geen symbolen oplevert: leid af uit materiaal + categorie.
  if (!items.length) {
    const mat = String(attrs?.materiaal ?? "").toLowerCase();
    const hg = String(attrs?.hoofdgroep_omschrijving ?? "").toLowerCase();
    const both = `${mat} ${hg}`;
    if (/leer|leder|suède|suede|nubuck/.test(mat)) {
      add("nowash", "Niet wassen");
      add("dryclean", "Professioneel reinigen");
    } else if (/pak|colbert|smoking|gilet|jacquet|rok|wol|kasjmier|zijde/.test(both)) {
      add("dryclean", "Professioneel reinigen");
      add("notumble", "Niet in de droger");
      add("ironlow", "Strijken lage temp.");
    } else if (String(attrs?.strijkvrij ?? "").toLowerCase() === "ja") {
      add("ironlow", "Strijkvrij — nauwelijks strijken");
      add("wash30", "Wassen 30°C");
    } else {
      add("wash30", "Wassen 30°C");
      add("nobleach", "Niet bleken");
      add("ironlow", "Strijken lage temp.");
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
    .map((l) => l.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}△◯▭♨️Ⓟⓕ•|]+/gu, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
