import { getProductsByHandles, type ProductCardData } from "@/lib/catalog";
import { getSanityLooks, getSanityLook, urlForImage } from "@/lib/sanity";

/**
 * "Shop the look" — gecureerde outfits met klikbare hotspots op een modelfoto
 * (Mr Marvis-stijl, eigen GENTS-twist: gelegenheid-first + dresscode-laag).
 * Bron: Sanity ('look'-documenten, beheerbaar op /studio); valt terug op de
 * statische LOOKS hieronder als Sanity (nog) geen looks heeft. Hotspot-posities
 * zijn percentages op de foto.
 */

export type Hotspot = { x: number; y: number; handle: string; label?: string };
export type Look = {
  slug: string;
  title: string;
  subtitle: string;
  occasion: string;
  image: string;
  hotspots: Hotspot[];
};

export const LOOKS: Look[] = [
  {
    slug: "bruiloftsgast",
    title: "De bruiloftsgast",
    subtitle: "Stijlvol en zomers — net iets meer dan gemiddeld.",
    occasion: "Bruiloft",
    image: "/brand/brand-model-navy.jpg",
    hotspots: [
      { x: 50, y: 30, handle: "colbert-sjas-blauw", label: "Colbert" },
      { x: 50, y: 45, handle: "smoking-ov-vadermoord-plisse", label: "Overhemd" },
      { x: 50, y: 72, handle: "m-m-pantalon-blend-navy", label: "Pantalon" },
      { x: 50, y: 93, handle: "lakschoen", label: "Schoenen" },
    ],
  },
  {
    slug: "business-klassiek",
    title: "Business klassiek",
    subtitle: "Onberispelijk voor de boardroom.",
    occasion: "Zakelijk",
    image: "/brand/brand-model-charcoal.jpg",
    hotspots: [
      { x: 50, y: 28, handle: "colbert-sjas-blauw", label: "Colbert" },
      { x: 50, y: 46, handle: "smoking-ov-vadermoord-plisse", label: "Overhemd" },
      { x: 52, y: 40, handle: "set-das-manchet-pochet-wit", label: "Das & pochet" },
      { x: 50, y: 74, handle: "m-m-pantalon-blend-navy", label: "Pantalon" },
    ],
  },
];

/** Sanity-look → component-vorm (afbeelding via Sanity-CDN). */
function fromSanity(s: {
  title: string;
  slug: string;
  occasion?: string;
  subtitle?: string;
  image?: unknown;
  hotspots?: { label?: string; handle?: string; x?: number; y?: number }[];
}): Look | null {
  const image = urlForImage(s.image, 1200);
  if (!image) return null;
  return {
    slug: s.slug,
    title: s.title,
    subtitle: s.subtitle || "",
    occasion: s.occasion || "",
    image,
    hotspots: (s.hotspots || [])
      .filter((h) => h.handle)
      .map((h) => ({ x: Number(h.x ?? 50), y: Number(h.y ?? 50), handle: h.handle!, label: h.label })),
  };
}

/** Alle looks — uit Sanity (beheerbaar), met statische fallback. */
export async function getAllLooks(): Promise<Look[]> {
  const sanity = await getSanityLooks();
  const fromCms = (sanity || []).map(fromSanity).filter(Boolean) as Look[];
  return fromCms.length ? fromCms : LOOKS;
}

/** Eén look op slug — Sanity eerst, dan statisch. */
export async function getLookBySlug(slug: string): Promise<Look | null> {
  const s = await getSanityLook(slug);
  const fromCms = s ? fromSanity(s) : null;
  return fromCms ?? LOOKS.find((l) => l.slug === slug) ?? null;
}

/** Synchrone statische lookup (alleen fallback-data). */
export function getLook(slug: string): Look | null {
  return LOOKS.find((l) => l.slug === slug) ?? null;
}

export type ResolvedHotspot = Hotspot & { product: ProductCardData | null };
export type ResolvedLook = Look & { products: ResolvedHotspot[] };

/** Look met opgehaalde productdata per hotspot (live uit de catalogus). */
export async function resolveLook(look: Look): Promise<ResolvedLook> {
  const handles = [...new Set(look.hotspots.map((h) => h.handle))];
  const cards = await getProductsByHandles(handles);
  const byHandle = new Map(cards.map((c) => [c.handle, c]));
  return {
    ...look,
    products: look.hotspots.map((h) => ({ ...h, product: byHandle.get(h.handle) ?? null })),
  };
}
