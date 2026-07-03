import type { Locale } from "@/lib/i18n";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getSiteSettings, type SiteSettings } from "@/lib/site-settings";
import { ensureEntries, getTranslationStore, pickFreshTranslation, type TransEntry } from "@/lib/translate";

/**
 * i18n-laag over de portal-bewerkbare site-content (hero). De hero-teksten komen
 * uit de settings-content-store (app_settings.site) — géén vaste i18n-catalogsleutels,
 * want marketeers wijzigen ze zonder deploy. Daarom: de nachtelijke vertaal-cron
 * vertaalt de ACTUELE bronteksten (ns "site", delta op bron-hash), en het renderen
 * pakt alleen een vertaling die nog bij de huidige bron hoort (pickFreshTranslation) —
 * een gewijzigde campagnetekst toont dus nooit een stale vertaling.
 *
 * MERKREGEL: de slogan "Suits You" (hero-eyebrow-default) wordt NOOIT vertaald —
 * het merk "GENTS — SUITS YOU" is onaantastbaar in alle talen.
 */

const BRAND_SLOGAN = /^suits\s+you$/i;

function heroEntries(s: SiteSettings): TransEntry[] {
  const list: TransEntry[] = [];
  const add = (key: string, source?: string) => {
    const v = (source || "").trim();
    if (!v) return;
    if (key === "hero.eyebrow" && BRAND_SLOGAN.test(v)) return; // slogan nooit vertalen
    list.push({ ns: "site", key, source: v });
  };
  add("hero.eyebrow", s.hero.eyebrow);
  add("hero.title", s.hero.title);
  add("hero.subtitle", s.hero.subtitle);
  add("hero.primary.label", s.hero.primary?.label);
  add("hero.secondary.label", s.hero.secondary?.label);
  return list;
}

/** Voor de vertaal-cron: vertaal de actuele hero-teksten (delta) naar één locale. */
export async function ensureSiteContent(locale: Locale): Promise<{ translated: number; total: number }> {
  const s = await getSiteSettings();
  return ensureEntries(heroEntries(s), locale, "ui");
}

/** Site-settings met de hero vertaald voor deze locale (NL = ongewijzigd pass-through). */
export async function getLocalizedSiteSettings(locale: Locale): Promise<SiteSettings> {
  const s = await getSiteSettings();
  if (locale === DEFAULT_LOCALE) return s;
  const store = await getTranslationStore(locale);
  const pick = (key: string, source?: string) => {
    const v = (source || "").trim();
    if (!v) return source;
    if (key === "hero.eyebrow" && BRAND_SLOGAN.test(v)) return source; // slogan blijft
    return pickFreshTranslation(store, "site", key, v);
  };
  return {
    ...s,
    hero: {
      ...s.hero,
      eyebrow: pick("hero.eyebrow", s.hero.eyebrow) || s.hero.eyebrow,
      title: pick("hero.title", s.hero.title) || s.hero.title,
      subtitle: pick("hero.subtitle", s.hero.subtitle),
      primary: { ...s.hero.primary, label: pick("hero.primary.label", s.hero.primary.label) || s.hero.primary.label },
      secondary: s.hero.secondary
        ? { ...s.hero.secondary, label: pick("hero.secondary.label", s.hero.secondary.label) || s.hero.secondary.label }
        : s.hero.secondary,
    },
  };
}
