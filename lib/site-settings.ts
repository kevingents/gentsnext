/**
 * Site-instellingen — VOORLOPIG statisch hier; wordt in een volgende ronde
 * vervangen door een Sanity-singleton 'siteSettings' zodat marketeers ze
 * zonder code kunnen aanpassen (banner, hero, USPs, drempel).
 *
 * Wat we nu al CMS-klaar als shape hebben:
 *  - announcement  (banner-tekst bovenaan)
 *  - hero          (foto óf video, met titel/CTA)
 *  - usps          (de strip onder de hero)
 *  - freeShippingCents, deliveryCutoffHour (drempels)
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

/**
 * Server-getter — straks de Sanity-fetch. Nu de statische export, met
 * dezelfde signature zodat we de PDP/homepage niet hoeven aan te passen
 * zodra Sanity er is.
 */
export async function getSiteSettings(): Promise<SiteSettings> {
  return SITE_SETTINGS;
}
