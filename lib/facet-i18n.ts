import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Locale } from "@/lib/i18n";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { COLOR_FAMILIES } from "@/lib/colors";
import { ensureEntries, getTranslationStore, pickFreshTranslation, type TransEntry, type Store } from "@/lib/translate";
import type { Facets } from "@/lib/catalog";
import { typeLabel } from "@/lib/catalog";

/**
 * i18n-laag over de FILTER-WAARDEN op de PLP (kleur, type, materiaal, dessin,
 * seizoen, pasvorm). De filterkoppen liepen al via t(), maar de waarden kwamen
 * rauw uit de catalogus — op /en /de stond dus "Color: Blauw · Type: 2-delig".
 *
 * Zelfde rail als nav/hero: ns "fc", sleutel = de brontekst, de nachtelijke cron
 * vertaalt de delta en het renderen pakt alleen een hash-verse vertaling. De
 * `value` (URL/filterlogica) blijft ALTIJD de Nederlandse bronwaarde — alleen
 * het zichtbare label vertaalt, zodat gedeelde filter-links blijven werken.
 *
 * Maten (M/48/One) blijven onvertaald: dat zijn codes, geen woorden.
 */

const NS = "fc";

/** Alle facet-bronteksten in de catalogus (bounded set, ~150 waarden). */
async function facetSourceTexts(): Promise<string[]> {
  const db = getDb();
  const rows = (await db.execute<{ v: string | null }>(sql`
    with ctx as materialized (
      select attributes from products where status = 'active' and has_image = true
    )
    select distinct attributes->>'subgroep' v from ctx where coalesce(attributes->>'subgroep','') <> ''
    union select distinct attributes->>'materiaal' from ctx where coalesce(attributes->>'materiaal','') <> ''
    union select distinct attributes->>'print_design' from ctx where coalesce(attributes->>'print_design','') <> ''
    union select distinct attributes->>'seizoen' from ctx where coalesce(attributes->>'seizoen','') <> ''
    union select distinct attributes->>'pasvorm' from ctx where coalesce(attributes->>'pasvorm','') <> ''
  `)).rows;
  const out = new Set<string>();
  for (const r of rows) {
    const v = (r.v || "").trim();
    if (v) out.add(typeLabel(v)); // "MM" → "Mix & match": vertaal wat de klant ziet
  }
  for (const c of COLOR_FAMILIES) out.add(c.label);
  return [...out];
}

/** Voor de vertaal-cron: filter-waarden (delta) naar één locale. */
export async function ensureFacetContent(locale: Locale): Promise<{ translated: number; total: number }> {
  if (locale === DEFAULT_LOCALE) return { translated: 0, total: 0 };
  const entries: TransEntry[] = (await facetSourceTexts()).map((s) => ({ ns: NS, key: s, source: s }));
  return ensureEntries(entries, locale, "ui");
}

const pick = (store: Store, v: string) => (v ? pickFreshTranslation(store, NS, v, v) || v : v);

/** Facetten met vertaalde labels; `value` blijft de NL-bronwaarde (URL-stabiel). */
export async function localizeFacets(locale: Locale, facets: Facets): Promise<Facets> {
  if (locale === DEFAULT_LOCALE) return facets;
  const store = await getTranslationStore(locale);
  return {
    ...facets,
    types: facets.types.map((t) => ({ ...t, label: pick(store, t.label) })),
    colors: facets.colors.map((c) => ({ ...c, label: pick(store, c.label) })),
    materials: facets.materials.map((m) => ({ ...m, label: pick(store, m.value) })),
    patterns: facets.patterns.map((p) => ({ ...p, label: pick(store, p.value) })),
    seasons: facets.seasons.map((s) => ({ ...s, label: pick(store, s.value) })),
    fits: facets.fits.map((f) => ({ ...f, label: pick(store, f.value) })),
  };
}
