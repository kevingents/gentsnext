import { uiSourceKeys } from "@/lib/messages";
import { getSiteSettings } from "@/lib/site-settings";
import { LANDINGS } from "@/lib/landings";
import { getMenu } from "@/lib/menu-server";
import { getFooter } from "@/lib/footer-server";
import { CATEGORIES } from "@/lib/categories";

/**
 * Bron-van-waarheid voor de beheerpagina "Vertalingen" (/account/vertalingen):
 * álle Nederlandse teksten die de vertaal-cron oppakt, in vier namespaces.
 *
 *  - ui      → microcopy uit lib/messages (knoppen, labels, meldingen)
 *  - nav     → hoofdmenu, footer-kolommen en categorie-labels (lib/nav-i18n)
 *  - site    → homepage-hero uit de site-instellingen
 *  - landing → landingspagina's uit lib/landings
 *
 * De sleutels (`<ns>:<key>`) zijn exact dezelfde als die de cron en de
 * KV-store `translations:<locale>` gebruiken — anders zou een handmatige
 * override op een andere sleutel landen dan de site uitleest. Voor "nav" is de
 * sleutel dus de brontekst zélf (zo doet lib/nav-i18n het ook: hetzelfde label
 * in menu én footer wordt één keer vertaald).
 */

export type TranslationSource = { ns: string; key: string; source: string };

/** Namespaces met een leesbare naam, voor de filterknoppen in de beheer-UI. */
export const TRANSLATION_NAMESPACES: { ns: string; label: string }[] = [
  { ns: "ui", label: "Microcopy" },
  { ns: "nav", label: "Navigatie" },
  { ns: "site", label: "Homepage" },
  { ns: "landing", label: "Landingspagina's" },
];

export async function collectTranslationSources(): Promise<TranslationSource[]> {
  const out: TranslationSource[] = [];

  for (const e of uiSourceKeys()) out.push({ ns: "ui", key: e.key, source: e.source });

  // Navigatie: menu-labels/kolomkoppen, footer-intro/kolommen en de
  // categorie-labels. Zelfde verzameling als ensureNavContent (lib/nav-i18n):
  // ontdubbeld op de brontekst, "#" is een placeholder-link en telt niet mee.
  try {
    const [menu, footer] = await Promise.all([getMenu(), getFooter()]);
    const seen = new Set<string>();
    const addNav = (source?: string) => {
      const v = (source || "").trim();
      if (!v || v === "#" || seen.has(v)) return;
      seen.add(v);
      out.push({ ns: "nav", key: v, source: v });
    };
    for (const item of menu) {
      addNav(item.label);
      for (const col of item.columns || []) {
        addNav(col.title);
        for (const l of col.links) addNav(l.label);
      }
      for (const f of item.features || []) {
        addNav(f.label);
        addNav(f.caption);
      }
    }
    addNav(footer.intro);
    for (const col of footer.columns) {
      addNav(col.title);
      for (const l of col.links) addNav(l.label);
    }
    for (const c of CATEGORIES) addNav(c.label);
  } catch {
    // Menu/footer onbereikbaar → alleen de overige namespaces tonen.
  }

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
