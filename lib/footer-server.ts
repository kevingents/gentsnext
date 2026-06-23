import { getContentDoc } from "@/lib/content-store";

/**
 * De footer-inhoud — uit onze eigen content-store (content:footer, beheerbaar in
 * de GENTS-portal) met de onderstaande standaard als seed/fallback wanneer er
 * (nog) geen footer is bewerkt. Vervangt de oude Sanity-bron.
 */

export type FooterCol = { title: string; links: { label: string; href: string }[] };
export type FooterDoc = { intro: string; columns: FooterCol[] };

const DEFAULT_INTRO =
  "Dé specialist voor je formele momenten. Betaalbare luxe, persoonlijk advies — online en in onze winkels.";

const DEFAULT_COLS: FooterCol[] = [
  {
    title: "Shoppen",
    links: [
      { label: "Pakken", href: "/categorie/pakken" },
      { label: "Overhemden", href: "/categorie/overhemden" },
      { label: "Pak samenstellen", href: "/pak-samenstellen" },
      { label: "Gelegenheden", href: "/gelegenheden" },
      { label: "Shop the look", href: "/looks" },
      { label: "Cadeaubon", href: "/cadeaubon" },
      { label: "Favorieten", href: "/favorieten" },
      { label: "Alle collecties", href: "/collections" },
    ],
  },
  {
    title: "Juridisch",
    links: [
      { label: "Algemene voorwaarden", href: "/pages/algemene-voorwaarden" },
      { label: "Privacyverklaring", href: "/pages/privacyverklaring" },
      { label: "Cookies", href: "/pages/cookies" },
      { label: "Herroepingsformulier", href: "/pages/herroepingsformulier" },
    ],
  },
  {
    title: "Service",
    links: [
      { label: "Klantenservice", href: "/pages/service" },
      { label: "Maatadvies", href: "/maatadvies" },
      { label: "Bezorging & levertijd", href: "/pages/bezorgkosten-levertijden" },
      { label: "Retourneren", href: "/pages/retourneren" },
      { label: "Onze winkels", href: "/pages/winkels" },
    ],
  },
  {
    title: "GENTS",
    links: [
      { label: "Over GENTS", href: "/pages/over-gents" },
      { label: "Etiquette & dresscodes", href: "/pages/etiquette" },
      { label: "Trouwen met GENTS", href: "/pages/trouwen-met-gents" },
      { label: "Zakelijk", href: "/pages/zakelijk" },
      { label: "Studenten & verenigingen", href: "/pages/students" },
      { label: "Werken bij GENTS", href: "/pages/werken-bij-gents" },
    ],
  },
];

export const DEFAULT_FOOTER: FooterDoc = { intro: DEFAULT_INTRO, columns: DEFAULT_COLS };

export async function getFooter(): Promise<FooterDoc> {
  const doc = await getContentDoc<FooterDoc>("footer");
  const columns = (doc?.columns || [])
    .map((c) => ({
      title: (c.title || "").trim(),
      links: (c.links || []).filter((l) => l?.label && l?.href) as { label: string; href: string }[],
    }))
    .filter((c) => c.title && c.links.length);
  return {
    intro: (doc?.intro || "").trim() || DEFAULT_INTRO,
    columns: columns.length ? columns : DEFAULT_COLS,
  };
}
