import { uiSourceKeys } from "@/lib/messages";
import { getSiteSettings } from "@/lib/site-settings";
import { LANDINGS } from "@/lib/landings";

/**
 * Bron-van-waarheid voor de beheerpagina "Vertalingen" (/account/vertalingen):
 * álle Nederlandse teksten die de vertaal-cron oppakt, in drie namespaces.
 *
 *  - ui      → microcopy uit lib/messages (knoppen, labels, meldingen)
 *  - site    → homepage-hero uit de site-instellingen
 *  - landing → landingspagina's uit lib/landings
 *
 * De sleutels (`<ns>:<key>`) zijn exact dezelfde als die de cron en de
 * KV-store `translations:<locale>` gebruiken — anders zou een handmatige
 * override op een andere sleutel landen dan de site uitleest.
 */

export type TranslationSource = { ns: string; key: string; source: string };

/** Namespaces met een leesbare naam, voor de filterknoppen in de beheer-UI. */
export const TRANSLATION_NAMESPACES: { ns: string; label: string }[] = [
  { ns: "ui", label: "Microcopy" },
  { ns: "site", label: "Homepage" },
  { ns: "landing", label: "Landingspagina's" },
];

export async function collectTranslationSources(): Promise<TranslationSource[]> {
  const out: TranslationSource[] = [];

  for (const e of uiSourceKeys()) out.push({ ns: "ui", key: e.key, source: e.source });

  try {
    const s = await getSiteSettings();
    const add = (key: string, source?: string) => {
      const v = (source || "").trim();
      // De merk-tagline blijft onvertaald.
      if (v && !/^suits\s+you$/i.test(v)) out.push({ ns: "site", key, source: v });
    };
    add("hero.eyebrow", s.hero.eyebrow);
    add("hero.title", s.hero.title);
    add("hero.subtitle", s.hero.subtitle);
    add("hero.primary.label", s.hero.primary?.label);
    add("hero.secondary.label", s.hero.secondary?.label);
  } catch {
    // Site-instellingen onbereikbaar → alleen de overige namespaces tonen.
  }

  for (const l of Object.values(LANDINGS)) {
    if (l.handle.startsWith("_")) continue;
    const add = (key: string, source?: string) => {
      const v = (source || "").trim();
      if (v) out.push({ ns: "landing", key: `${l.handle}.${key}`, source: v });
    };
    add("eyebrow", l.eyebrow);
    add("title", l.title);
    add("intro", l.intro);
    add("cta.label", l.cta?.label);
    l.sections.forEach((sec, i) => {
      add(`sections.${i}.title`, sec.title);
      add(`sections.${i}.body`, sec.body);
    });
    l.shop.forEach((sh, i) => add(`shop.${i}.label`, sh.label));
  }

  return out;
}
