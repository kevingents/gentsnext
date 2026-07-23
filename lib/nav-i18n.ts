import type { Locale } from "@/lib/i18n";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getMenu } from "@/lib/menu-server";
import { getFooter, type FooterDoc } from "@/lib/footer-server";
import { CATEGORIES } from "@/lib/categories";
import { ensureEntries, getTranslationStore, pickFreshTranslation, type TransEntry, type Store } from "@/lib/translate";
import type { MenuItem } from "@/lib/main-menu";

/**
 * i18n-laag over de navigatie-CONTENT: hoofdmenu, footer-kolommen en de
 * categorie-labels. Die teksten zijn portal-bewerkbaar (menu-/footer-doc) of
 * catalogus-gebonden (CATEGORIES) — géén vaste catalog-keys, dus zelfde patroon
 * als de hero (lib/site-settings-i18n): de nachtelijke vertaal-cron vertaalt de
 * ACTUELE bronteksten (ns "nav", delta op bron-hash) en het renderen pakt alleen
 * een vertaling die nog bij de huidige bron hoort. Sleutel = de brontekst zelf:
 * hetzelfde label ("Winkels" in menu én footer) wordt zo één keer vertaald.
 *
 * MERKREGEL: het woordmerk/de slogan wordt nooit vertaald; "GENTS" komt hier
 * niet als losse tekst voorbij (alleen als onderdeel van namen — die blijven).
 */

const NS = "nav";

function collectTexts(menu: MenuItem[], footer: FooterDoc): string[] {
  const out = new Set<string>();
  const add = (v?: string) => {
    const s = (v || "").trim();
    if (s && s !== "#") out.add(s);
  };
  for (const item of menu) {
    add(item.label);
    for (const col of item.columns || []) {
      add(col.title);
      for (const l of col.links) add(l.label);
    }
    for (const f of item.features || []) {
      add(f.label);
      add(f.caption);
    }
  }
  add(footer.intro);
  for (const col of footer.columns) {
    add(col.title);
    for (const l of col.links) add(l.label);
  }
  for (const c of CATEGORIES) add(c.label);
  return [...out];
}

/** Voor de vertaal-cron: vertaal de actuele nav-teksten (delta) naar één locale. */
export async function ensureNavContent(locale: Locale): Promise<{ translated: number; total: number }> {
  const [menu, footer] = await Promise.all([getMenu(), getFooter()]);
  const entries: TransEntry[] = collectTexts(menu, footer).map((s) => ({ ns: NS, key: s, source: s }));
  return ensureEntries(entries, locale, "ui");
}

const pick = (store: Store, v: string) => pickFreshTranslation(store, NS, v, v) || v;

/** Hoofdmenu met vertaalde labels (NL = pass-through). */
export async function getLocalizedMenu(locale: Locale): Promise<MenuItem[]> {
  const menu = await getMenu();
  if (locale === DEFAULT_LOCALE) return menu;
  const store = await getTranslationStore(locale);
  return menu.map((item) => ({
    ...item,
    label: pick(store, item.label),
    columns: item.columns?.map((col) => ({
      ...col,
      title: col.title ? pick(store, col.title) : col.title,
      links: col.links.map((l) => ({ ...l, label: pick(store, l.label) })),
    })),
    features: item.features?.map((f) => ({
      ...f,
      label: pick(store, f.label),
      caption: f.caption ? pick(store, f.caption) : f.caption,
    })),
  }));
}

/** Footer-doc met vertaalde intro/kolommen (NL = pass-through). */
export async function getLocalizedFooter(locale: Locale): Promise<FooterDoc> {
  const footer = await getFooter();
  if (locale === DEFAULT_LOCALE) return footer;
  const store = await getTranslationStore(locale);
  return {
    ...footer,
    intro: pick(store, footer.intro),
    columns: footer.columns.map((col) => ({
      ...col,
      title: pick(store, col.title),
      links: col.links.map((l) => ({ ...l, label: pick(store, l.label) })),
    })),
  };
}

/** Categorie-labels per slug, vertaald (voor home-tegels en PLP-koppen). */
export async function getCategoryLabels(locale: Locale): Promise<Map<string, string>> {
  const out = new Map(CATEGORIES.map((c) => [c.slug, c.label]));
  if (locale === DEFAULT_LOCALE) return out;
  const store = await getTranslationStore(locale);
  for (const c of CATEGORIES) out.set(c.slug, pick(store, c.label));
  return out;
}
