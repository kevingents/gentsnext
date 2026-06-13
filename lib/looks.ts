import { getProductsByHandles, type ProductCardData } from "@/lib/catalog";
import { getSanityLooks, getSanityLook, urlForImage } from "@/lib/sanity";
import type { Settings } from "@/lib/settings";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { sortSizes } from "@/lib/sizing";

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

/**
 * Bouwt een "Shop de look" rond een AI-modelfoto: het canvas-model draagt een
 * vaste basis-outfit (settings.modelLook); we plaatsen het getoonde product op de
 * juiste hoogte voor zijn categorie en voegen de basis-stukken toe (behalve die
 * van dezelfde hoofdgroep, om dubbeling te voorkomen). Hotspot-posities zijn
 * percentages — vast, want het model staat altijd in dezelfde pose.
 */
const TARGET_Y: Record<string, number> = {
  Overhemden: 24, "Polo-shirts": 30, "T-Shirts": 30, Truien: 33, Vesten: 33,
  Gilets: 36, Colberts: 34, Broeken: 71, Pakken: 42,
};

export function buildModelLook(
  p: { handle: string; hoofdgroep: string; modelImageUrl?: string | null; title?: string },
  modelLook: Settings["modelLook"],
): Look | null {
  if (!modelLook?.enabled || !p.modelImageUrl) return null;
  const y = TARGET_Y[p.hoofdgroep] ?? 36;
  const base = (modelLook.items || []).filter(
    (it) => it.handle && it.handle !== p.handle && it.hoofdgroep !== p.hoofdgroep,
  );
  const hotspots: Hotspot[] = [
    { x: 50, y, handle: p.handle, label: "Dit item" },
    ...base.map((it) => ({ x: it.x, y: it.y, handle: it.handle, label: it.label })),
  ];
  if (hotspots.length < 2) return null; // alleen het item zelf is geen "look"
  return {
    slug: p.handle,
    title: "Compleet de look",
    subtitle: "Zo style je dit item — shop de volledige outfit van het model.",
    occasion: "Shop de look",
    image: p.modelImageUrl,
    hotspots,
  };
}

export type ResolvedHotspot = Hotspot & { product: ProductCardData | null };
export type ResolvedLook = Look & { products: ResolvedHotspot[] };

/** Koopgegevens per look-product: maten + voorraad + sku voor direct-in-winkelwagen. */
export type LookBuySize = { size: string; sku: string; priceCents: number; qty: number };
export type LookBuyData = { color: string; hoofdgroep: string; sizes: LookBuySize[] };

export async function getLookBuyData(handles: string[]): Promise<Record<string, LookBuyData>> {
  const uniq = [...new Set(handles.filter(Boolean))];
  if (!uniq.length) return {};
  const db = getDb();
  const rows = await db.execute<{ handle: string; color: string; size: string; sku: string; price: number; qty: number; hg: string }>(sql`
    select p.handle, coalesce(v.color,'') color, coalesce(v.size,'') size, coalesce(v.sku,'') sku,
      v.price_cents price, v.stock_qty qty, p.attributes->>'hoofdgroep_omschrijving' hg
    from products p join product_variants v on v.product_id = p.id
    where p.handle in (${sql.join(uniq.map((h) => sql`${h}`), sql`, `)}) and coalesce(v.size,'') <> ''
    order by p.handle, v.position asc
  `);
  const out: Record<string, LookBuyData> = {};
  for (const r of rows.rows) {
    let e = out[r.handle];
    if (!e) {
      e = { color: r.color, hoofdgroep: r.hg || "", sizes: [] };
      out[r.handle] = e;
    }
    if (e.sizes.some((s) => s.size === r.size)) continue;
    e.sizes.push({ size: r.size, sku: r.sku, priceCents: Number(r.price) || 0, qty: Number(r.qty) || 0 });
  }
  for (const handle of Object.keys(out)) out[handle].sizes = sortSizes(out[handle].sizes);
  return out;
}

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
