/**
 * Leidt de INDEX van het handboek af uit de code zelf → content/handboek-index.json.
 *
 * Draait bij elke build (zie package.json). Dat is de hele reden dat dit bestaat:
 * een handboek dat met de hand wordt bijgehouden loopt binnen twee sprints achter,
 * en dan gelooft niemand het meer. De verhaalkant staat in content/handboek.ts; de
 * lijsten — welke modules, welke endpoints, welke tabellen — komen hiervandaan.
 *
 * Wat we oogsten is het eerste blok-commentaar bovenaan een bestand. Dat is in deze
 * repo de plek waar staat wát iets doet en waaróm, dus een nieuwe module beschrijft
 * zichzelf al; je hoeft alleen die kop te schrijven zoals je toch al deed.
 *
 * BEWUST GEEN TIJDSTEMPEL in de uitvoer: dan geeft elke build een diff en wordt het
 * bestand ruis in de geschiedenis. Twee keer draaien op dezelfde code geeft exact
 * hetzelfde bestand.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const WORTEL = process.cwd();

type Module = { pad: string; naam: string; domein: string; samenvatting: string };
type Endpoint = { pad: string; poort: string; methoden: string[]; samenvatting: string };
type Index = { modules: Module[]; endpoints: Endpoint[]; tabellen: string[] };

/** Alle bestanden onder een map, gesorteerd zodat de uitvoer deterministisch is. */
function bestanden(map: string, uitgang = /\.(ts|tsx)$/): string[] {
  const uit: string[] = [];
  const loop = (p: string) => {
    let items: string[];
    try {
      items = readdirSync(p).sort();
    } catch {
      return;
    }
    for (const naam of items) {
      const vol = join(p, naam);
      if (statSync(vol).isDirectory()) {
        if (naam === "node_modules" || naam.startsWith(".")) continue;
        loop(vol);
      } else if (uitgang.test(naam)) uit.push(vol);
    }
  };
  loop(map);
  return uit.sort();
}

/** Het eerste blok-commentaar in de kop van een bestand, als platte tekst. */
function kopTekst(src: string): string {
  const kop = src.split("\n").slice(0, 80).join("\n");
  const m = kop.match(/\/\*\*([\s\S]*?)\*\//);
  if (!m) return "";
  return m[1]
    .split("\n")
    .map((r) => r.replace(/^\s*\*\s?/, "").trimEnd())
    .join("\n")
    .trim();
}

/** Eerste een/twee zinnen, hard afgekapt — een index is geen tekstboek. */
function samenvat(tekst: string, max = 260): string {
  const plat = tekst.replace(/\s+/g, " ").trim();
  if (!plat) return "";
  if (plat.length <= max) return plat;
  const punt = plat.lastIndexOf(". ", max);
  return (punt > 80 ? plat.slice(0, punt + 1) : plat.slice(0, max).trimEnd() + "…").trim();
}

/**
 * Domein-indeling. Bewust op naamherkenning en niet op mapstructuur: de mappen
 * zijn technisch ingedeeld (lib/, app/api/) en het handboek is dat juist niet.
 * Onbekend valt in "Overig" — zichtbaar, zodat het opvalt en een plek krijgt.
 */
const DOMEINEN: [RegExp, string][] = [
  [/^(catalog|product|pim|prijs|pricing|price|merchandis|variant|color|categor|collect|brand|facet|search|size|maat|sizing|care|packshot|beeld|media|model|lifestyle|visual|hero|new-collection|shopify)/, "Catalogus"],
  [/^(stock|srs|safety|inbound|inventory|transfer|receiv|unfulfil|fulfil|split|store-core|store-reserve|reservation|reservations|display|veiligheids|print-inbox)/, "Keten en voorraad"],
  [/^(order|checkout|cart|payment|mollie|worldline|voucher|giftcard|smoking|student|refund|invoice|packing|pakbon|shipping|dhl|delivery|promo)/, "Kopen en orders"],
  [/^(customer|account|identity|loyalty|club|punten|wallet|apple|google|audience|email|mail|newsletter|support|helpdesk|ticket|klant|profiel|review|judgeme|social)/, "Klant en marketing"],
  [/^(pos|bonnr|receipt|web-dagstaat|exact|worldline-pos|kas)/, "Kassa"],
  [/^(i18n|locale|translate|translation|messages|nav|menu|footer|content|homepage|landings|looks|occasions|page|seo|redirect|blog|etiquette|site-settings|main-menu|reserved-page)/, "Site en content"],
  [/^(analytics|track|event|heatmap|experiment|ab-|reports|insights|attributie|datalayer|consent|portal-usage|mijn-winkel|nav-insights)/, "Meten"],
  [/^(sandbox|cron|rate-limit|timing|safe|blob|inflight|load-env|site-url|format|xlsx|studio-token|store-core-token)/, "Platform"],
];

function domeinVan(naam: string): string {
  for (const [patroon, domein] of DOMEINEN) if (patroon.test(naam)) return domein;
  return "Overig";
}

/** Welke poort bewaakt dit endpoint? Afgeleid uit de gebruikte auth-helper. */
function poortVan(src: string): string {
  if (/coreAuth\s*\(/.test(src)) return "Core-token (kassa en scanner)";
  if (/adminOrToken\s*\(/.test(src)) return "Studio-token (portal en beheerder)";
  if (/cronSecretOk\s*\(/.test(src)) return "Cron-geheim";
  if (/getSessionCustomer\s*\(/.test(src)) return "Klantsessie";
  return "Publiek";
}

function methodenVan(src: string): string[] {
  const uit = new Set<string>();
  for (const m of src.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) uit.add(m[1]);
  return [...uit].sort();
}

function bouwIndex(): Index {
  const modules: Module[] = [];
  for (const vol of bestanden(join(WORTEL, "lib"))) {
    const pad = relative(WORTEL, vol).replace(/\\/g, "/");
    const naam = pad.replace(/^lib\//, "").replace(/\.(ts|tsx)$/, "");
    const samenvatting = samenvat(kopTekst(readFileSync(vol, "utf8")));
    if (!samenvatting) continue; // geen kop = (nog) geen verhaal om te tonen
    modules.push({ pad, naam, domein: domeinVan(naam), samenvatting });
  }

  const endpoints: Endpoint[] = [];
  for (const vol of bestanden(join(WORTEL, "app", "api"))) {
    if (!/route\.ts$/.test(vol)) continue;
    const src = readFileSync(vol, "utf8");
    const pad =
      "/" +
      relative(join(WORTEL, "app"), vol)
        .replace(/\\/g, "/")
        .replace(/\/route\.ts$/, "");
    endpoints.push({
      pad,
      poort: poortVan(src),
      methoden: methodenVan(src),
      samenvatting: samenvat(kopTekst(src), 200),
    });
  }

  let tabellen: string[] = [];
  try {
    const schema = readFileSync(join(WORTEL, "db", "schema.ts"), "utf8");
    tabellen = [...schema.matchAll(/export const \w+ = pgTable\(\s*"([a-z0-9_]+)"/g)].map((m) => m[1]).sort();
  } catch {
    /* geen schema = lege lijst; het handboek toont dan gewoon niets */
  }

  return { modules, endpoints: endpoints.sort((a, b) => a.pad.localeCompare(b.pad)), tabellen };
}

const index = bouwIndex();
const doel = join(WORTEL, "content", "handboek-index.json");
writeFileSync(doel, JSON.stringify(index, null, 2) + "\n", "utf8");
console.log(
  `handboek-index: ${index.modules.length} modules, ${index.endpoints.length} endpoints, ${index.tabellen.length} tabellen → content/handboek-index.json`,
);
