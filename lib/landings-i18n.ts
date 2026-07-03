import type { Locale } from "@/lib/i18n";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { LANDINGS, type Landing } from "@/lib/landings";
import { ensureEntries, getTranslationStore, pickFreshTranslation, type TransEntry } from "@/lib/translate";

/**
 * i18n-laag over de statische storytelling-landings (lib/landings.ts) — zelfde
 * patroon als de hero (lib/site-settings-i18n): de nachtelijke cron vertaalt de
 * bronteksten (ns "landing", delta op bron-hash) en het renderen pakt alleen een
 * vertaling die nog bij de huidige bron hoort. Handmatige overrides uit de
 * beheer-UI winnen altijd (pickFreshTranslation).
 */

function landingEntries(l: Landing): TransEntry[] {
  const list: TransEntry[] = [];
  const add = (key: string, source?: string) => {
    const v = (source || "").trim();
    if (v) list.push({ ns: "landing", key: `${l.handle}.${key}`, source: v });
  };
  add("eyebrow", l.eyebrow);
  add("title", l.title);
  add("intro", l.intro);
  add("cta.label", l.cta?.label);
  l.sections.forEach((s, i) => {
    add(`sections.${i}.title`, s.title);
    add(`sections.${i}.body`, s.body);
  });
  l.shop.forEach((s, i) => add(`shop.${i}.label`, s.label));
  return list;
}

/** Voor de vertaal-cron: alle actieve landings (delta) naar één locale. */
export async function ensureLandingsContent(locale: Locale): Promise<{ translated: number; total: number }> {
  const entries = Object.values(LANDINGS)
    .filter((l) => !l.handle.startsWith("_"))
    .flatMap(landingEntries);
  return ensureEntries(entries, locale, "ui");
}

/** Landing met vertaalde teksten voor deze locale (NL = pass-through). */
export async function getLocalizedLanding(landing: Landing, locale: Locale): Promise<Landing> {
  if (locale === DEFAULT_LOCALE) return landing;
  const store = await getTranslationStore(locale);
  const pick = (key: string, source: string) =>
    source?.trim() ? pickFreshTranslation(store, "landing", `${landing.handle}.${key}`, source) : source;
  return {
    ...landing,
    eyebrow: pick("eyebrow", landing.eyebrow),
    title: pick("title", landing.title),
    intro: pick("intro", landing.intro),
    cta: { ...landing.cta, label: pick("cta.label", landing.cta.label) },
    sections: landing.sections.map((s, i) => ({
      ...s,
      title: pick(`sections.${i}.title`, s.title),
      body: pick(`sections.${i}.body`, s.body),
    })),
    shop: landing.shop.map((s, i) => ({ ...s, label: pick(`shop.${i}.label`, s.label) })),
  };
}
