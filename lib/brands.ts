/** Merken die we als eigen pagina presenteren — slug → catalogus-merknaam + intro. */
export type Brand = {
  slug: string;
  name: string;
  vendor: string; // exacte waarde in attributes.merk
  intro: string;
  heroImage: string;
};

export const BRANDS: Brand[] = [
  {
    slug: "blumfontain",
    name: "Blumfontain",
    vendor: "Blumfontain",
    intro:
      "Blumfontain — onze eigen lijn van overhemden, pakken en accessoires. Tijdloze stukken in moderne pasvormen, ontwikkeld voor elk formeel moment.",
    heroImage: "/brand/brand-model-charcoal.jpg",
  },
  {
    slug: "gents",
    name: "GENTS",
    vendor: "GENTS",
    intro:
      "De GENTS-collectie. Persoonlijk samengesteld door onze stylisten, met focus op pasvorm, materiaal en de gelegenheid.",
    heroImage: "/brand/brand-model-grey3piece.jpg",
  },
  {
    slug: "newstar",
    name: "Newstar",
    vendor: "Newstar",
    intro:
      "Newstar — verfijnde overhemden en accessoires met aandacht voor detail.",
    heroImage: "/brand/brand-product-fabric.jpg",
  },
];

const BY_SLUG = new Map(BRANDS.map((b) => [b.slug, b]));

export function brandBySlug(slug: string): Brand | null {
  return BY_SLUG.get(slug) ?? null;
}
