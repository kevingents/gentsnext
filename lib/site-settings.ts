import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { getSettings } from "@/lib/settings";

/**
 * Site-instellingen (homepage-content): announcement, hero, USP's. Bron van
 * waarheid = DB-rij app_settings.site (portal-beheerbaar via de "Nieuwe site"-
 * CMS → Instellingen), met onderstaande SITE_SETTINGS als fallback/default.
 * Zo passen marketeers banner/hero/USP's aan zónder code/redeploy.
 *
 * De gratis-verzend-drempel komt uit de CENTRALE settings (app_settings.global,
 * lib/settings.ts) zodat homepage-messaging en de winkelwagen altijd dezelfde
 * drempel tonen — één bron, geen drift.
 *
 * Shape (CMS-klaar):
 *  - announcement  (banner-tekst bovenaan)
 *  - hero          (foto óf video, met titel/CTA)
 *  - usps          (de strip onder de hero)
 *  - freeShippingCents, deliveryCutoffHour (drempels; freeShipping ← global)
 */

export type SiteSettings = {
  announcement: { text: string; linkLabel?: string; linkHref?: string };
  hero: {
    eyebrow: string;
    title: string;
    subtitle?: string;
    videoUrl?: string;
    videoUrlMobile?: string;
    posterUrl: string;
    primary: { label: string; href: string };
    secondary?: { label: string; href: string };
  };
  usps: string[];
  freeShippingCents: number;
  deliveryCutoffHour: number; // 16 = vóór 16:00 besteld
};

export const SITE_SETTINGS: SiteSettings = {
  announcement: {
    text: "Gratis verzending vanaf € 75 · Persoonlijk advies in onze 19 winkels —",
    linkLabel: "vind een winkel",
    linkHref: "/pages/winkels",
  },
  hero: {
    eyebrow: "Suits You",
    title: "Perfect gekleed voor elk formeel moment",
    subtitle:
      "Van bruiloft tot boardroom. Betaalbare luxe met persoonlijk advies van de dresscode-experts van GENTS.",
    videoUrl: "https://cdn.shopify.com/videos/c/o/v/57250833ccb74de5ade8487047a669f5.mp4",
    posterUrl: "/brand/brand-model-charcoal.jpg",
    primary: { label: "Shop pakken", href: "/categorie/pakken" },
    secondary: { label: "Stel je pak samen", href: "/pak-samenstellen" },
  },
  usps: [
    "Formele-momenten specialist",
    "Betaalbare luxe",
    "Gratis retour binnen 14 dagen",
    "Persoonlijk advies in 19 winkels",
  ],
  freeShippingCents: 7500,
  deliveryCutoffHour: 16,
};

/** Velden die de portal mag overschrijven (de rest blijft default). */
export type SiteSettingsPatch = Partial<Pick<SiteSettings, "announcement" | "hero" | "usps" | "deliveryCutoffHour">>;

let _cache: SiteSettings | null = null;
let _at = 0;
const TTL = 30_000;

/**
 * Server-getter: DB-overrides (app_settings.site) over SITE_SETTINGS, met de
 * gratis-verzend-drempel uit de centrale settings (één bron). Zelfde signature
 * als voorheen, dus homepage/PDP hoeven niet aangepast.
 */
export async function getSiteSettings(): Promise<SiteSettings> {
  if (_cache && Date.now() - _at < TTL) return _cache;
  let stored: SiteSettingsPatch = {};
  let freeShippingCents = SITE_SETTINGS.freeShippingCents;
  try {
    const db = getDb();
    const rows = await db.select().from(appSettings).where(eq(appSettings.id, "site")).limit(1);
    stored = (rows[0]?.data ?? {}) as SiteSettingsPatch;
    freeShippingCents = (await getSettings()).freeShippingCents;
  } catch {
    stored = {};
  }
  _cache = {
    ...SITE_SETTINGS,
    ...stored,
    announcement: { ...SITE_SETTINGS.announcement, ...(stored.announcement || {}) },
    hero: { ...SITE_SETTINGS.hero, ...(stored.hero || {}) },
    usps: Array.isArray(stored.usps) && stored.usps.length ? stored.usps : SITE_SETTINGS.usps,
    freeShippingCents,
  };
  _at = Date.now();
  return _cache;
}

/** Werkt de homepage-content bij (portal/admin) en leegt de cache. */
export async function updateSiteSettings(patch: SiteSettingsPatch): Promise<SiteSettings> {
  const db = getDb();
  const rows = await db.select().from(appSettings).where(eq(appSettings.id, "site")).limit(1);
  const current = (rows[0]?.data ?? {}) as SiteSettingsPatch;
  const next: SiteSettingsPatch = {
    ...current,
    ...patch,
    announcement: patch.announcement ? { ...current.announcement, ...patch.announcement } : current.announcement,
    hero: patch.hero ? { ...current.hero, ...patch.hero } : current.hero,
  };
  await db
    .insert(appSettings)
    .values({ id: "site", data: next, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: appSettings.id, set: { data: next, updatedAt: sql`now()` } });
  _cache = null;
  _at = 0;
  return getSiteSettings();
}
