import type { ProductFilters, ProductSort } from "@/lib/catalog";

/** Vorm van de PLP-URL-parameters (gedeeld tussen server-parsing en client-UI). */
export type PlpSelection = {
  types: string[];
  materials: string[];
  seasons: string[];
  ironFree: boolean;
  colors: string[];
  sizes: string[];
  fits: string[];
  priceMin?: number; // euro's
  priceMax?: number; // euro's
  sort: ProductSort;
  page: number;
};

const SORTS: ProductSort[] = ["nieuw", "prijs-op", "prijs-af", "naam"];

function csv(v: string | undefined): string[] {
  return (v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parsePlpParams(sp: Record<string, string | string[] | undefined>): PlpSelection {
  const get = (k: string): string | undefined => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const sortRaw = get("sort") as ProductSort | undefined;
  const [pMin, pMax] = csv(get("prijs")).map((n) => Number(n));
  return {
    types: csv(get("type")),
    materials: csv(get("materiaal")),
    seasons: csv(get("seizoen")),
    ironFree: get("strijkvrij") === "1",
    colors: csv(get("kleur")),
    sizes: csv(get("maat")),
    fits: csv(get("pasvorm")),
    priceMin: Number.isFinite(pMin) && pMin > 0 ? pMin : undefined,
    priceMax: Number.isFinite(pMax) && pMax > 0 ? pMax : undefined,
    sort: sortRaw && SORTS.includes(sortRaw) ? sortRaw : "nieuw",
    page: Math.max(1, Math.floor(Number(get("page")) || 1)),
  };
}

/** Bouwt een query-string uit een selectie (lege waarden weggelaten). */
export function buildPlpQuery(sel: Partial<PlpSelection>): string {
  const p = new URLSearchParams();
  if (sel.types?.length) p.set("type", sel.types.join(","));
  if (sel.materials?.length) p.set("materiaal", sel.materials.join(","));
  if (sel.seasons?.length) p.set("seizoen", sel.seasons.join(","));
  if (sel.ironFree) p.set("strijkvrij", "1");
  if (sel.colors?.length) p.set("kleur", sel.colors.join(","));
  if (sel.sizes?.length) p.set("maat", sel.sizes.join(","));
  if (sel.fits?.length) p.set("pasvorm", sel.fits.join(","));
  if (sel.priceMin || sel.priceMax) p.set("prijs", `${sel.priceMin ?? 0}-${sel.priceMax ?? 0}`);
  if (sel.sort && sel.sort !== "nieuw") p.set("sort", sel.sort);
  if (sel.page && sel.page > 1) p.set("page", String(sel.page));
  return p.toString();
}

/** Selectie → ProductFilters (cents) voor de query-laag. */
export function selectionToFilters(
  sel: PlpSelection,
  base: { collectionId?: string; category?: string }
): ProductFilters {
  return {
    ...base,
    types: sel.types,
    materials: sel.materials,
    seasons: sel.seasons,
    ironFree: sel.ironFree,
    colorFamilies: sel.colors,
    sizes: sel.sizes,
    fits: sel.fits,
    priceMinCents: sel.priceMin ? sel.priceMin * 100 : undefined,
    priceMaxCents: sel.priceMax ? sel.priceMax * 100 : undefined,
  };
}

export const SORT_LABELS: Record<ProductSort, string> = {
  nieuw: "Nieuwste",
  "prijs-op": "Prijs oplopend",
  "prijs-af": "Prijs aflopend",
  naam: "Naam (A–Z)",
};
