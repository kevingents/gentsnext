import { getSanityOccasions, urlForImage, type SanityOccasion } from "@/lib/sanity";

/**
 * Gelegenheden voor /gelegenheden — uit Sanity (beheerbaar in de Studio) met de
 * onderstaande standaard als fallback. De links sluiten aan op de bestaande
 * collecties/landingen.
 */

export type Occasion = {
  slug: string;
  title: string;
  eyebrow: string;
  intro: string;
  image: string;
  ctaLabel: string;
  ctaHref: string;
  links: { label: string; href: string }[];
};

const FALLBACK: Occasion[] = [
  {
    slug: "bruiloft",
    title: "Bruiloft",
    eyebrow: "Voor de grote dag",
    intro: "Een trouwpak dat past bij jullie dag — van klassiek tot eigentijds. Persoonlijk advies in de winkel of online.",
    image: "/brand/brand-impression-wedding.jpg",
    ctaLabel: "Shop trouwpakken",
    ctaHref: "/collections/trouwen",
    links: [
      { label: "Trouwaccessoires", href: "/collections/trouw-accessoires" },
      { label: "Afspraak maken", href: "/pages/trouw-afspraak" },
    ],
  },
  {
    slug: "gala-black-tie",
    title: "Gala & Black Tie",
    eyebrow: "Black tie & white tie",
    intro: "Smoking, dinnerjacket of rokkostuum — onberispelijk gekleed voor het meest formele moment.",
    image: "/brand/brand-impression-gala.jpg",
    ctaLabel: "Shop smokings",
    ctaHref: "/collections/smoking",
    links: [
      { label: "Dinnerjackets", href: "/collections/dinner-jacket" },
      { label: "Rokkostuum", href: "/collections/rokkostuum" },
      { label: "Jacquet", href: "/collections/jacquets" },
      { label: "Dresscodes uitgelegd", href: "/pages/etiquette" },
    ],
  },
  {
    slug: "zakelijk",
    title: "Zakelijk",
    eyebrow: "Kantoor & sollicitatie",
    intro: "Een pak waarin je serieus genomen wordt. Combineer los voor de perfecte pasvorm.",
    image: "/brand/brand-impression-interview.jpg",
    ctaLabel: "Shop business pakken",
    ctaHref: "/collections/mix-match-pakken",
    links: [
      { label: "Business overhemden", href: "/collections/business-overhemden" },
      { label: "Voor studenten", href: "/pages/students" },
    ],
  },
  {
    slug: "uitvaart",
    title: "Uitvaart",
    eyebrow: "Met respect gekleed",
    intro: "Ingetogen en correct gekleed op een afscheid — snel leverbaar en met persoonlijke hulp wanneer het moet.",
    image: "/brand/brand-impression-funeral.jpg",
    ctaLabel: "Bekijk uitvaartkleding",
    ctaHref: "/pages/uitvaartkleding",
    links: [{ label: "Onze winkels", href: "/pages/winkels" }],
  },
];

function fromSanity(o: SanityOccasion): Occasion | null {
  if (!o?.title || !o?.slug) return null;
  return {
    slug: o.slug,
    title: o.title,
    eyebrow: o.eyebrow || "",
    intro: o.intro || "",
    image: o.image ? urlForImage(o.image, 900) : "",
    ctaLabel: o.ctaLabel || "Bekijk",
    ctaHref: o.ctaHref || "#",
    links: (o.links || []).filter((l) => l?.label && l?.href),
  };
}

export async function getOccasions(): Promise<Occasion[]> {
  try {
    const data = await getSanityOccasions();
    const items = (data || []).map(fromSanity).filter(Boolean) as Occasion[];
    return items.length ? items : FALLBACK;
  } catch {
    return FALLBACK;
  }
}
