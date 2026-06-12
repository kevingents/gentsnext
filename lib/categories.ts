/**
 * Hoofdcategorieën — gebaseerd op hoofdgroep_omschrijving in de catalogus.
 * Deze geven de echte, volledige categorie-listings (i.t.t. de vaak kleine,
 * gecureerde Shopify-collecties). Slug = URL onder /categorie/<slug>.
 */
export type Category = { slug: string; label: string; hoofdgroep: string };

export const CATEGORIES: Category[] = [
  { slug: "pakken", label: "Pakken", hoofdgroep: "Pakken" },
  { slug: "colberts", label: "Colberts", hoofdgroep: "Colberts" },
  { slug: "pantalons", label: "Pantalons", hoofdgroep: "Broeken" },
  { slug: "overhemden", label: "Overhemden", hoofdgroep: "Overhemden" },
  { slug: "gilets", label: "Gilets", hoofdgroep: "Gilets" },
  { slug: "truien", label: "Truien", hoofdgroep: "Truien" },
  { slug: "stropdassen", label: "Stropdassen", hoofdgroep: "Stropdassen" },
  { slug: "strikken", label: "Strikken", hoofdgroep: "Strikken" },
  { slug: "pochets", label: "Pochets", hoofdgroep: "Pochet" },
  { slug: "schoenen", label: "Schoenen", hoofdgroep: "Schoenen" },
  { slug: "riemen", label: "Riemen", hoofdgroep: "Riemen" },
  { slug: "jassen", label: "Jassen", hoofdgroep: "Jassen" },
];

const BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

export function categoryBySlug(slug: string): Category | null {
  return BY_SLUG.get(slug) ?? null;
}

/** De hoofd-navigatie (subset, in volgorde). */
export const NAV_CATEGORIES = ["pakken", "colberts", "pantalons", "overhemden", "gilets", "stropdassen"]
  .map((s) => BY_SLUG.get(s))
  .filter(Boolean) as Category[];
