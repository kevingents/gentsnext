import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Locale } from "@/lib/i18n";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { ensureEntries, getTranslationStore, pickFreshTranslation, hash, type TransEntry } from "@/lib/translate";

/**
 * i18n-laag over de COLLECTIES (titel + omschrijving). Producten lopen al via
 * product_translations (ensureCatalogTranslations + lib/catalog); collecties
 * hadden nog niets. Zelfde rail als hero/nav: de nachtelijke vertaal-cron
 * vertaalt de actuele bronteksten (delta op bron-hash), het renderen pakt
 * alleen verse vertalingen — een hernoemde collectie toont dus nooit een
 * stale vertaling maar de NL-bron tot de cron 'm oppakt.
 *
 * Namespaces (key = collectie-handle): ct = titel · cd = omschrijving (HTML).
 * SEO: vertaalde titel/omschrijving stromen door naar kop, meta en breadcrumb
 * op de collectie-PLP's (/en /de) — met de bestaande hreflang-alternates.
 */

/** Voor de vertaal-cron: collectie-teksten (delta) naar één locale. */
export async function ensureCollectionsContent(locale: Locale): Promise<{ translated: number; total: number }> {
  if (locale === DEFAULT_LOCALE) return { translated: 0, total: 0 };
  const db = getDb();
  const colls = await db.execute<{ handle: string; title: string; description_html: string }>(sql`
    select handle, title, description_html from collections
  `);
  const entries: TransEntry[] = [];
  for (const c of colls.rows) {
    if ((c.title || "").trim()) entries.push({ ns: "ct", key: c.handle, source: c.title.trim() });
    if ((c.description_html || "").trim()) entries.push({ ns: "cd", key: c.handle, source: c.description_html.trim() });
  }
  // Delta-filter vooraf (ensureEntries filtert zelf ook, maar zo blijft de
  // batch klein en de cron-run snel).
  const store = await getTranslationStore(locale);
  const todo = entries.filter((e) => {
    const cur = store[`${e.ns}:${e.key}`];
    if (cur?.m) return false;
    return !cur || cur.h !== hash(e.source);
  });
  return ensureEntries(todo, locale, "description");
}

/** Eén collectie-tekst vertaald (verse-hash; NL = pass-through). */
export async function localizeCollectionText(
  locale: Locale,
  ns: "ct" | "cd",
  handle: string,
  source: string,
): Promise<string> {
  const v = (source || "").trim();
  if (locale === DEFAULT_LOCALE || !v) return source;
  const store = await getTranslationStore(locale);
  return pickFreshTranslation(store, ns, handle, v) || source;
}

/** Meerdere collectie-titels in één store-read (voor de /collections-index). */
export async function localizeCollectionTitles<T extends { handle: string; title: string }>(
  locale: Locale,
  items: T[],
): Promise<T[]> {
  if (locale === DEFAULT_LOCALE || !items.length) return items;
  const store = await getTranslationStore(locale);
  return items.map((it) => ({ ...it, title: pickFreshTranslation(store, "ct", it.handle, it.title.trim()) || it.title }));
}
