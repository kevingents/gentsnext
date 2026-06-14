import { getSanityFooter } from "@/lib/sanity";

/**
 * De footer-inhoud — uit Sanity (beheerbaar in de Studio) met de onderstaande
 * standaard als veilige fallback wanneer er (nog) geen footer in de CMS staat.
 */

export type FooterCol = { title: string; links: { label: string; href: string }[] };

const DEFAULT_INTRO =
  "Dé specialist voor je formele momenten. Betaalbare luxe, persoonlijk advies — online en in onze winkels.";

const DEFAULT_COLS: FooterCol[] = [
  {
    title: "Shoppen",
    links: [
      { label: "Pakken", href: "/categorie/pakken" },
      { label: "Overhemden", href: "/categorie/overhemden" },
      { label: "Pak samenstellen", href: "/pak-samenstellen" },
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

export async function getFooter(): Promise<{ intro: string; columns: FooterCol[] }> {
  try {
    const data = await getSanityFooter();
    const columns = (data?.columns || [])
      .map((c) => ({
        title: (c.title || "").trim(),
        links: (c.links || []).filter((l) => l?.label && l?.href) as { label: string; href: string }[],
      }))
      .filter((c) => c.title && c.links.length);
    return {
      intro: (data?.intro || "").trim() || DEFAULT_INTRO,
      columns: columns.length ? columns : DEFAULT_COLS,
    };
  } catch {
    return { intro: DEFAULT_INTRO, columns: DEFAULT_COLS };
  }
}
