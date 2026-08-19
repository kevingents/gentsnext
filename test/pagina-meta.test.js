import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/* Waakhond op de pagina-metadata.
 *
 * De <title> is het zwaarste on-page SEO-signaal, en die stond op élke pagina
 * hardgecodeerd in het Nederlands — ook op /en, /de, /fr en /es. Dat is nu
 * opgelost via lib/page-meta-i18n, maar zo'n fix verdampt zodra iemand de
 * volgende pagina weer met `title: "Iets Nederlands"` aanmaakt. Deze test leest
 * de bronbestanden en houdt dat tegen; hij hoeft dus geen database of build.
 *
 * Zelfde soort waakhond als de sandbox-anonimisatietest: iets wat niemand
 * handmatig controleert, dat stil verkeerd kan gaan. */

const SHOP = "app/(shop)";

function paginas(dir = SHOP, uit = []) {
  for (const naam of readdirSync(dir)) {
    const pad = join(dir, naam);
    if (statSync(pad).isDirectory()) paginas(pad, uit);
    else if (naam === "page.tsx") uit.push(pad.split("\\").join("/"));
  }
  return uit;
}

/** Het metadata-blok van een paginabestand (generateMetadata of `export const metadata`). */
function metaBlok(bron) {
  const regels = bron.split(/\r?\n/);
  const start = regels.findIndex(
    (l) => l.startsWith("export async function generateMetadata") || l.startsWith("export const metadata")
  );
  if (start < 0) return null;
  for (let i = start + 1; i < regels.length; i++) {
    if (/^\};?$/.test(regels[i])) return regels.slice(start, i + 1).join("\n");
  }
  return regels.slice(start).join("\n");
}

/**
 * Letterlijke title/description-waarden in een metadata-blok.
 * Een sjabloonstring die alleen uit ${...} bestaat telt niet als letterlijk;
 * eentje met eigen woorden erin wél (dat was precies de pak-samenstellen-bug).
 */
function letterlijkeTeksten(blok) {
  const uit = [];
  for (const m of blok.matchAll(/^\s*(title|description):\s*(.+)$/gm)) {
    const waarde = m[2].trim();
    if (waarde.startsWith('"')) uit.push(`${m[1]}: ${waarde}`);
    else if (waarde.startsWith("`")) {
      const zonderPlaceholders = waarde.replace(/\$\{[^}]*\}/g, "").replace(/[`,]/g, "").trim();
      if (zonderPlaceholders.length > 2) uit.push(`${m[1]}: ${waarde}`);
    }
  }
  return uit;
}

/** Paden waarvoor de meta uit een andere, wél vertaalde bron komt. */
const EIGEN_BRON = new Set([
  "app/(shop)/products/[handle]/page.tsx", // product_translations
  "app/(shop)/collections/[handle]/page.tsx", // localizeCollectionText
  "app/(shop)/categorie/[slug]/page.tsx", // getCategoryLabels + t()
  "app/(shop)/merken/[slug]/page.tsx", // localizedBrand
  "app/(shop)/maattabellen/[slug]/page.tsx", // localizedSizeGuide
  "app/(shop)/members/page.tsx", // t()
  "app/(shop)/blog/[slug]/page.tsx", // blogpost uit de database
  "app/(shop)/looks/[slug]/page.tsx", // look uit de database
  "app/(shop)/pages/[handle]/page.tsx", // localizedPageMeta + getLocalizedLanding
]);

test("geen enkele shop-pagina heeft nog een hardgecodeerde titel of omschrijving", () => {
  const zondaars = [];
  for (const f of paginas()) {
    if (EIGEN_BRON.has(f)) continue;
    const blok = metaBlok(readFileSync(f, "utf8"));
    if (!blok) continue;
    const fout = letterlijkeTeksten(blok);
    if (fout.length) zondaars.push(`${f}\n    ${fout.join("\n    ")}`);
  }
  assert.equal(
    zondaars.length,
    0,
    `Deze pagina's zetten hun meta nog als letterlijke tekst neer. Zet ze in PAGE_META ` +
      `(lib/page-meta-i18n.ts) en gebruik pageMetadata("<pad>"), anders staat de titel ` +
      `op /en /de /fr /es in het Nederlands:\n  ${zondaars.join("\n  ")}`
  );
});

test("elk pad dat pageMetadata() aanroept staat ook in PAGE_META", () => {
  const registry = readFileSync("lib/page-meta-i18n.ts", "utf8");
  const bekend = new Set([...registry.matchAll(/^\s{2}"(\/[^"]*)":/gm)].map((m) => m[1]));
  assert.ok(bekend.size >= 12, `PAGE_META lijkt leeg of onleesbaar (${bekend.size} paden)`);

  const ontbreekt = [];
  for (const f of paginas()) {
    const bron = readFileSync(f, "utf8");
    for (const m of bron.matchAll(/(?:pageMetadata|localizedPageMeta)\(\s*"([^"]+)"/g)) {
      if (!bekend.has(m[1])) ontbreekt.push(`${f} → ${m[1]}`);
    }
  }
  assert.equal(ontbreekt.length, 0, `Pad niet in PAGE_META:\n  ${ontbreekt.join("\n  ")}`);
});

test("geen enkele pagina in PAGE_META heeft een lege titel", () => {
  const registry = readFileSync("lib/page-meta-i18n.ts", "utf8");
  for (const m of registry.matchAll(/^\s{2}"(\/[^"]*)":\s*\{([^}]*)\}/gm)) {
    const titel = m[2].match(/title:\s*"([^"]*)"/);
    if (titel) assert.ok(titel[1].trim().length > 0, `${m[1]} heeft een lege titel`);
  }
});

test("elke vaste pagina levert canonical + hreflang, niet alleen canonical", () => {
  // `alternates: { canonical: ... }` zonder localeAlternates betekent dat Google
  // de taalvarianten van die pagina niet te zien krijgt. Dat was zo op vijf
  // pagina's die `export const metadata` gebruikten.
  const zondaars = [];
  for (const f of paginas()) {
    const blok = metaBlok(readFileSync(f, "utf8"));
    if (!blok) continue;
    if (/alternates:\s*\{\s*canonical:/.test(blok)) zondaars.push(f);
  }
  assert.equal(
    zondaars.length,
    0,
    `Deze pagina's zetten canonical handmatig en missen daardoor hreflang; gebruik ` +
      `localeAlternates() of pageMetadata():\n  ${zondaars.join("\n  ")}`
  );
});
