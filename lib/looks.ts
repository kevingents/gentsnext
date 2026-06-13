import { getProductsByHandles, type ProductCardData } from "@/lib/catalog";

/**
 * "Shop the look" — gecureerde outfits met klikbare hotspots op een modelfoto
 * (Mr Marvis-stijl, eigen GENTS-twist: gelegenheid-first + dresscode-laag).
 * Voorlopig statisch hier; klaar om naar een Sanity-singleton 'look' te
 * verhuizen (zelfde shape). Hotspot-posities zijn percentages op de foto.
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
