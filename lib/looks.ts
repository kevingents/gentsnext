import { getProductsByHandles, type ProductCardData } from "@/lib/catalog";
import { getContentDoc, setContentDoc } from "@/lib/content-store";
import type { Settings } from "@/lib/settings";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { sortSizes } from "@/lib/sizing";
import { colorSwatch } from "@/lib/colors";

/**
 * "Shop the look" — gecureerde outfits met klikbare hotspots op een modelfoto
 * (Mr Marvis-stijl, eigen GENTS-twist: gelegenheid-first + dresscode-laag).
 * Bron: de eigen looks-store (portal-beheerd, content:looks) bovenop de statische
 * LOOKS hieronder als basis. Hotspot-posities zijn percentages op de foto.
 */

export type Hotspot = { x: number; y: number; handle: string; label?: string };
export type Look = {
  slug: string;
  title: string;
  subtitle: string;
  occasion: string;
  /** Optioneel thema (bv. "Peaky Blinders", "Italiaanse zomer") — naast gelegenheid filterbaar. */
  theme?: string;
  image: string;
  /** Extra sfeerbeelden onder de hoofd-modelfoto (geen hotspots). */
  images?: string[];
  /** Verhaal/styling-uitleg bij de look (storytelling) — alinea's gescheiden door \n\n. */
  story?: string;
  hotspots: Hotspot[];
};

export const LOOKS: Look[] = [
  {
    slug: "bruiloftsgast",
    title: "De bruiloftsgast",
    subtitle: "Stijlvol en zomers — net iets meer dan gemiddeld.",
    occasion: "Bruiloft",
    image: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-models/colbert-sjas-blauw-model.jpg",
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
    image: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-models/m-m-colbert-pw-antra-model.jpg",
    hotspots: [
      { x: 50, y: 28, handle: "m-m-colbert-pw-antra", label: "Colbert" },
      { x: 50, y: 46, handle: "overhemd-nos-wit", label: "Overhemd" },
      { x: 52, y: 40, handle: "set-das-manchet-pochet-wit", label: "Das & pochet" },
      { x: 50, y: 74, handle: "m-m-pantalon-blend-navy", label: "Pantalon" },
    ],
  },
  {
    slug: "gala-black-tie",
    title: "Gala & black tie",
    subtitle: "Onberispelijk in smoking — voor de meest formele avond.",
    occasion: "Gala",
    theme: "Black tie",
    image: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-models/jas-smoking-punt-pv-zwart-model.jpg",
    hotspots: [
      { x: 50, y: 22, handle: "smoking-ov-plat-glad", label: "Overhemd" },
      { x: 55, y: 28, handle: "strik-poly-zwart", label: "Strik" },
      { x: 50, y: 36, handle: "m-m-colbert-blend-zwart", label: "Colbert" },
      { x: 50, y: 72, handle: "broek-rok-smok-pv", label: "Pantalon" },
      { x: 50, y: 93, handle: "lakschoen", label: "Schoenen" },
    ],
  },
  {
    slug: "driedelig-klassiek",
    title: "Driedelig klassiek",
    subtitle: "Het driedelige pak — gezag met stijl.",
    occasion: "Zakelijk",
    image: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-models/colbert-blend-navy-mixmatch-model.jpg",
    hotspots: [
      { x: 50, y: 22, handle: "overhemd-nos-wit", label: "Overhemd" },
      { x: 50, y: 34, handle: "colbert-blend-navy-mixmatch", label: "Colbert" },
      { x: 50, y: 48, handle: "m-m-gilet-wol-blauw", label: "Gilet" },
      { x: 50, y: 72, handle: "m-m-pantalon-blend-navy", label: "Pantalon" },
      { x: 50, y: 93, handle: "veterschoen-glad-zwart", label: "Schoenen" },
    ],
  },
  {
    slug: "zomerse-bruiloftsgast",
    title: "Zomerse bruiloftsgast",
    subtitle: "Licht en zonnig — perfect voor een zomerbruiloft in het zuiden.",
    occasion: "Bruiloft",
    theme: "Italiaanse zomer",
    image: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-models/colbert-ruit-katoen-linnen-lichtblauw-model.jpg",
    hotspots: [
      { x: 50, y: 22, handle: "overhemd-nos-wit", label: "Overhemd" },
      { x: 55, y: 28, handle: "stropdas-pe-lichtblauw", label: "Das" },
      { x: 50, y: 34, handle: "colbert-ruit-katoen-linnen-lichtblauw", label: "Colbert" },
      { x: 50, y: 70, handle: "m-m-pantalon-blend-royalblue", label: "Pantalon" },
      { x: 50, y: 92, handle: "veterschoen-glad-tan", label: "Schoenen" },
    ],
  },
  {
    slug: "smoking-compleet",
    title: "Smoking compleet",
    subtitle: "Black tie van top tot teen — jas, overhemd, strik, broek en lakschoen.",
    occasion: "Gala",
    theme: "Compleet",
    image: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-models/jas-smoking-punt-pv-zwart-model.jpg",
    hotspots: [
      { x: 50, y: 22, handle: "smoking-ov-vadermoord-plisse", label: "Overhemd" },
      { x: 55, y: 28, handle: "strik-poly-zwart", label: "Strik" },
      { x: 50, y: 36, handle: "jas-smoking-punt-pv-zwart", label: "Smoking jas" },
      { x: 50, y: 72, handle: "broek-rok-smok-pv", label: "Pantalon" },
      { x: 50, y: 93, handle: "lakschoen", label: "Schoenen" },
    ],
  },
  {
    slug: "rokkostuum-compleet",
    title: "Rokkostuum compleet",
    subtitle: "White tie compleet — rokjas, rokvest, wing-overhemd, witte rokstrik, broek en lakschoen.",
    occasion: "Gala",
    theme: "Compleet",
    image: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-models/rokjas-pv-model.jpg",
    hotspots: [
      { x: 50, y: 20, handle: "smokingoverhemd-wingtip-wit", label: "Wing-overhemd" },
      { x: 55, y: 26, handle: "rokstrik-zelfstrik-pique", label: "Rokstrik" },
      { x: 50, y: 34, handle: "rokjas-pv", label: "Rokjas" },
      { x: 47, y: 46, handle: "rokvest-zwart", label: "Rokvest" },
      { x: 50, y: 72, handle: "broek-rok-smok-pv", label: "Pantalon" },
      { x: 50, y: 93, handle: "lakschoen", label: "Schoenen" },
    ],
  },
  {
    slug: "uitvaart",
    title: "Gepast bij een uitvaart",
    subtitle: "Sober en correct — een donker pak, wit overhemd, ingetogen das en zwarte schoenen.",
    occasion: "Uitvaart",
    image: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-models/pak-persignori-ruit-donkergrijs-model.jpg",
    hotspots: [
      { x: 50, y: 22, handle: "overhemd-nos-wit", label: "Overhemd" },
      { x: 55, y: 28, handle: "stropdas-clip-on-donkerblauw", label: "Das" },
      { x: 50, y: 40, handle: "pak-persignori-ruit-donkergrijs", label: "Pak" },
      { x: 50, y: 93, handle: "veterschoen-glad-zwart", label: "Schoenen" },
    ],
  },
  {
    slug: "zakelijk-glencheck",
    title: "Zakelijk met karakter",
    subtitle: "Glen check in blauw — krachtig en verzorgd voor de boardroom.",
    occasion: "Zakelijk",
    image: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-models/pak-glen-check-blauw-model.jpg",
    hotspots: [
      { x: 50, y: 22, handle: "overhemd-nos-wit", label: "Overhemd" },
      { x: 55, y: 28, handle: "stropdas-pe-lichtblauw", label: "Das" },
      { x: 50, y: 40, handle: "pak-glen-check-blauw", label: "Pak" },
      { x: 50, y: 93, handle: "leder-classic-cognac", label: "Schoenen" },
    ],
  },
  {
    slug: "bruiloft-linnen",
    title: "Bruiloftsgast in linnen",
    subtitle: "Licht katoen-linnen in lichtblauw — zomers, elegant en comfortabel.",
    occasion: "Bruiloft",
    theme: "Italiaanse zomer",
    image: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-models/pak-katoen-linnen-lichtblauw-model.jpg",
    hotspots: [
      { x: 50, y: 22, handle: "overhemd-nos-wit", label: "Overhemd" },
      { x: 55, y: 28, handle: "stropdas-pe-lichtblauw", label: "Das" },
      { x: 50, y: 40, handle: "pak-katoen-linnen-lichtblauw", label: "Pak" },
      { x: 50, y: 93, handle: "leder-classic-cognac", label: "Schoenen" },
    ],
  },
  {
    slug: "examengala",
    title: "Examengala",
    subtitle: "Midnight teal met een zwarte strik — opvallend en gepast op je gala.",
    occasion: "Examengala",
    theme: "Galabal",
    image: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-models/pak-midnight-teal-model.jpg",
    hotspots: [
      { x: 50, y: 22, handle: "overhemd-nos-wit", label: "Overhemd" },
      { x: 55, y: 28, handle: "strik-poly-zwart", label: "Strik" },
      { x: 50, y: 40, handle: "pak-midnight-teal", label: "Pak" },
      { x: 50, y: 93, handle: "lakschoen", label: "Schoenen" },
    ],
  },
  {
    slug: "communie-lentefeest",
    title: "Communie & lentefeest",
    subtitle: "Fris lichtblauw, driedelig — net gekleed voor het feest.",
    occasion: "Communie",
    image: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-models/pak-lichtblauw-3-delig-model.jpg",
    hotspots: [
      { x: 50, y: 22, handle: "overhemd-nos-wit", label: "Overhemd" },
      { x: 55, y: 28, handle: "stropdas-pe-lichtblauw", label: "Das" },
      { x: 50, y: 40, handle: "pak-lichtblauw-3-delig", label: "Pak" },
      { x: 50, y: 93, handle: "leder-classic-cognac", label: "Schoenen" },
    ],
  },
  {
    slug: "sollicitatie",
    title: "Sollicitatiegesprek",
    subtitle: "Verzorgd navy nailhead — betrouwbaar, scherp en zelfverzekerd.",
    occasion: "Sollicitatie",
    image: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-models/pak-nailhead-blauw-1-model.jpg",
    hotspots: [
      { x: 50, y: 22, handle: "overhemd-nos-wit", label: "Overhemd" },
      { x: 55, y: 28, handle: "stropdas-pe-lichtblauw", label: "Das" },
      { x: 50, y: 40, handle: "pak-nailhead-blauw-1", label: "Pak" },
      { x: 50, y: 93, handle: "leder-classic-cognac", label: "Schoenen" },
    ],
  },
  {
    slug: "feestdagen",
    title: "Feestdagen",
    subtitle: "Kastanjerood — warm en feestelijk voor de kerstdagen en het diner.",
    occasion: "Feestdagen",
    image: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-models/pak-kastanje-rood-1-model.jpg",
    hotspots: [
      { x: 50, y: 22, handle: "overhemd-nos-wit", label: "Overhemd" },
      { x: 55, y: 28, handle: "stropdas-met-pochet-paisley-ecru", label: "Das & pochet" },
      { x: 50, y: 40, handle: "pak-kastanje-rood-1", label: "Pak" },
      { x: 50, y: 93, handle: "leder-classic-cognac", label: "Schoenen" },
    ],
  },
];

/**
 * Storytelling per look (waarom deze combinatie + styling-logica, on-brand). Apart
 * gehouden van de outfit-data zodat 't makkelijk te onderhouden/uit te breiden is.
 * Sanity (look.story) overschrijft dit indien aanwezig.
 */
const LOOK_STORIES: Record<string, string> = {
  bruiloftsgast:
    "Een bruiloft vraagt om net iets meer dan doordeweeks, zonder de bruidegom te overschaduwen. Een blauw colbert met een wit overhemd en een nette pantalon zit precies goed: verzorgd, zomers en feestelijk.\n\nHoud de das subtiel en laat het colbert het werk doen — een outfit die past van de ceremonie tot het diner.",
  "business-klassiek":
    "Niets straalt zoveel rust en gezag uit als een onberispelijk antraciet pak. In de boardroom werkt ingetogen het sterkst: een wit overhemd, een verzorgde das en strakke lijnen.\n\nHoud accessoires subtiel — een pochet in wit of ijsblauw maakt het af zonder te schreeuwen.",
  "gala-black-tie":
    "Black tie is de meest formele dresscode die je tegenkomt, en juist daarom de makkelijkste: de regels doen het werk. Een zwarte smoking, een wit smokingoverhemd, een zwarte zelfstrik en lakschoenen — meer is het niet.\n\nDe onderste knoop van een gilet blijft open, en lakschoenen maken het plaatje compleet.",
  "driedelig-klassiek":
    "Het driedelige pak voegt een laag toe — letterlijk en figuurlijk. Het gilet geeft structuur en maakt elke verschijning net wat formeler en doordachter.\n\nDraag het gilet met de onderste knoop open, een wit overhemd eronder, en zwarte veterschoenen bij dit donkere navy.",
  "zomerse-bruiloftsgast":
    "Een zomerbruiloft in het zuiden vraagt om lucht en licht. Katoen-linnen in lichtblauw ademt mee met de dag en oogt moeiteloos elegant.\n\nCombineer met een wit overhemd, een lichtblauwe das en cognac schoenen — warme, lichte tinten vragen om bruin leer, nooit zwart.",
  "smoking-compleet":
    "De complete smoking, van jas tot lakschoen. Alles is op elkaar afgestemd zodat je je geen seconde druk hoeft te maken over de dresscode.\n\nZwarte zelfstrik, wit overhemd en lakschoenen — klassiek black tie, zonder twijfel.",
  "rokkostuum-compleet":
    "White tie is de hoogste dresscode die er is, gereserveerd voor de meest plechtige avonden. Het rokkostuum is compleet: rokjas, rokvest, wing-overhemd, witte piqué-strik, broek en lakschoen.\n\nHet rokvest hoort altijd bij de volledige rokjas — nooit los — en de witte strik onderscheidt white tie van black tie.",
  uitvaart:
    "Bij een uitvaart draait alles om respect en ingetogenheid. Een donker pak, een wit overhemd, een sobere das en zwarte schoenen — niets wat de aandacht trekt.\n\nKies gedekte tinten en houd accessoires tot een minimum; correct en stil is hier het uitgangspunt.",
  "zakelijk-glencheck":
    "Glen check geeft een klassiek pak net iets meer karakter zonder de zakelijke toon te verliezen. In blauw blijft het verzorgd en krachtig — ideaal voor wie wil opvallen met inhoud.\n\nEen wit overhemd en cognac schoenen houden het modern; het warme blauw vraagt om bruin leer.",
  "bruiloft-linnen":
    "Licht katoen-linnen in lichtblauw is gemaakt voor warme dagen buiten. Het valt soepel, kreukt met gratie en oogt altijd ontspannen-elegant.\n\nMet een wit overhemd, een lichtblauwe das en cognac schoenen ben je perfect gekleed voor een zomerbruiloft.",
  examengala:
    "Je gala is hét moment om net iets gewaagder te gaan. Midnight teal is donker genoeg om formeel te blijven, maar onderscheidt je van de zee aan zwarte pakken.\n\nEen zwarte strik en lakschoenen houden het feestelijk en af.",
  "communie-lentefeest":
    "Een communie of lentefeest is licht en vrolijk — je kleding mag dat weerspiegelen. Fris lichtblauw, driedelig, geeft een verzorgde maar ontspannen indruk.\n\nWit overhemd, een zachte das en cognac schoenen maken het compleet.",
  sollicitatie:
    "Bij een sollicitatie wil je betrouwbaar en scherp overkomen. Navy nailhead is precies dat: ingetogen van dichtbij, met diepte van veraf.\n\nHoud het clean — wit overhemd, subtiele das, cognac schoenen — en laat je verhaal de rest doen.",
  feestdagen:
    "De feestdagen mogen warmte uitstralen. Kastanjerood is feestelijk zonder te overdrijven en staat prachtig bij kaarslicht en diner.\n\nEen wit overhemd met een paisley das-en-pochet en cognac schoenen — warme tinten vragen om bruin leer.",
};

/** Voegt storytelling toe aan een look als die nog geen eigen story heeft. */
function withStory(look: Look): Look {
  if (look.story) return look;
  const story = LOOK_STORIES[look.slug];
  return story ? { ...look, story } : look;
}

/**
 * Alle looks — de in code gedefinieerde LOOKS als basis (altijd aanwezig), met
 * de eigen looks-store (portal-beheerd) eroverheen: gepubliceerde looks
 * overschrijven/voegen toe, concepten (draft) verbergen we op de storefront.
 */
export async function getAllLooks(): Promise<Look[]> {
  const bySlug = new Map<string, Look>(LOOKS.map((l) => [l.slug, l]));
  for (const sl of await getStoredLooks()) {
    if (sl.status === "published") bySlug.set(sl.slug, stripStatus(sl));
    else bySlug.delete(sl.slug);
  }
  return [...bySlug.values()].map(withStory);
}

/** Eén look op slug — eigen store eerst (alleen gepubliceerd), dan statisch. */
export async function getLookBySlug(slug: string): Promise<Look | null> {
  const stored = (await getStoredLooks()).find((l) => l.slug === slug);
  if (stored) return stored.status === "published" ? withStory(stripStatus(stored)) : null;
  const look = LOOKS.find((l) => l.slug === slug) ?? null;
  return look ? withStory(look) : null;
}

/* ── Portal-beheer (looks-store: app_settings content:looks) ──────────────── */

export type StoredLook = Look & { status: "published" | "draft"; updatedAt?: string };

function stripStatus(l: StoredLook): Look {
  const { status, updatedAt, ...look } = l;
  void status; void updatedAt;
  return look;
}

/** Ruwe looks uit de eigen store (incl. concepten). */
export async function getStoredLooks(): Promise<StoredLook[]> {
  const doc = await getContentDoc<{ items: StoredLook[] }>("looks");
  return Array.isArray(doc?.items) ? doc!.items : [];
}

/**
 * Alle looks vóór de portal-beheerpagina: de statische LOOKS als basis (status
 * 'published'), met de store-versie eroverheen (incl. concepten). Zo ziet de
 * beheerder álles en kan hij bestaande looks goedkeuren/bewerken.
 */
export async function getManagedLooks(): Promise<StoredLook[]> {
  const bySlug = new Map<string, StoredLook>(LOOKS.map((l) => [l.slug, { ...l, status: "published" as const }]));
  for (const sl of await getStoredLooks()) bySlug.set(sl.slug, sl);
  return [...bySlug.values()];
}

/** Sla een look op in de store (upsert op slug). */
export async function saveLook(look: StoredLook): Promise<void> {
  const items = await getStoredLooks();
  const idx = items.findIndex((l) => l.slug === look.slug);
  const next = { ...look, updatedAt: new Date().toISOString() };
  if (idx >= 0) items[idx] = next;
  else items.push(next);
  await setContentDoc("looks", { items });
}

/** Verwijder een look uit de store (de statische/Sanity-basis blijft bestaan). */
export async function deleteStoredLook(slug: string): Promise<void> {
  const items = (await getStoredLooks()).filter((l) => l.slug !== slug);
  await setContentDoc("looks", { items });
}

/** Synchrone statische lookup (alleen fallback-data). */
export function getLook(slug: string): Look | null {
  const look = LOOKS.find((l) => l.slug === slug);
  return look ? withStory(look) : null;
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

/**
 * MixMatch-pak als "look": colbert + broek + gilet (de losse, in dezelfde stof
 * combineerbare stukken — de GENTS-USP) + een wit overhemd en schoenen uit de
 * basis-outfit. Gebruikt op de PDP van een MixMatch-stuk i.p.v. de generieke look.
 */
export function buildSuitLook(opts: {
  currentHandle: string;
  modelImageUrl: string;
  colbertHandle?: string;
  broekHandle?: string;
  giletHandle?: string;
  shirtHandle?: string;
  shoesHandle?: string;
}): Look {
  const hotspots: Hotspot[] = [];
  if (opts.shirtHandle) hotspots.push({ x: 50, y: 24, handle: opts.shirtHandle, label: "Overhemd" });
  if (opts.colbertHandle) hotspots.push({ x: 50, y: 34, handle: opts.colbertHandle, label: "Colbert" });
  if (opts.giletHandle) hotspots.push({ x: 50, y: 48, handle: opts.giletHandle, label: "Gilet" });
  if (opts.broekHandle) hotspots.push({ x: 50, y: 72, handle: opts.broekHandle, label: "Pantalon" });
  if (opts.shoesHandle) hotspots.push({ x: 50, y: 93, handle: opts.shoesHandle, label: "Schoenen" });
  return {
    slug: opts.currentHandle,
    title: "Stel dit pak samen",
    subtitle: "Mix & match — colbert, broek en gilet los te combineren in dezelfde stof.",
    occasion: "Pak samenstellen",
    image: opts.modelImageUrl,
    hotspots,
  };
}

export type ResolvedHotspot = Hotspot & { product: ProductCardData | null };
export type ResolvedLook = Look & { products: ResolvedHotspot[] };

/** Koopgegevens per look-product: maten + voorraad + sku voor direct-in-winkelwagen. */
export type LookBuySize = { size: string; sku: string; priceCents: number; qty: number };
export type LookBuyData = { color: string; hoofdgroep: string; specs: string; sizes: LookBuySize[] };

export async function getLookBuyData(handles: string[]): Promise<Record<string, LookBuyData>> {
  const uniq = [...new Set(handles.filter(Boolean))];
  if (!uniq.length) return {};
  const db = getDb();
  const rows = await db.execute<{
    handle: string; color: string; size: string; sku: string; price: number; qty: number;
    hg: string; materiaal: string; samenstelling: string; pasvorm: string;
  }>(sql`
    select p.handle, coalesce(v.color,'') color, coalesce(v.size,'') size, coalesce(v.sku,'') sku,
      v.price_cents price, v.stock_qty qty, p.attributes->>'hoofdgroep_omschrijving' hg,
      p.attributes->>'materiaal' materiaal, p.attributes->>'samenstelling_materiaal' samenstelling,
      p.attributes->>'pasvorm' pasvorm
    from products p join product_variants v on v.product_id = p.id
    where p.handle in (${sql.join(uniq.map((h) => sql`${h}`), sql`, `)}) and coalesce(v.size,'') <> ''
    order by p.handle, v.position asc
  `);
  const out: Record<string, LookBuyData> = {};
  for (const r of rows.rows) {
    let e = out[r.handle];
    if (!e) {
      // Stijlvolle, korte spec-regel: materiaal/stof + pasvorm (zoals een atelier 'm noemt).
      const material = String(r.materiaal || r.samenstelling || "").trim();
      const pasvorm = String(r.pasvorm || "").trim();
      const specs = [material, pasvorm].filter(Boolean).join(" · ").slice(0, 80);
      e = { color: r.color, hoofdgroep: r.hg || "", specs, sizes: [] };
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

/**
 * Sfeerbeeld-galerij voor de look-detailpagina: verzamelt de sfeerbeelden
 * (lifestyle_image_url) van de look-producten — hoofdgarment (pak/colbert) eerst —
 * en kiest het mooiste als hero. Modelfoto's vullen de galerij aan. Zo wordt de
 * look een editorial sfeerbeeld i.p.v. één studio-modelshot. Valt terug op de
 * look-modelfoto als er nog geen sfeerbeelden zijn.
 */
export type LookGalleryImage = { url: string; alt: string; kind: "sfeer" | "model" };
const GARMENT_PRIORITY = ["Pakken", "Colberts", "Jassen", "Gilets", "Broeken"];

/**
 * Per-look, gelegenheid-passende sfeerbeelden (gegenereerd door
 * scripts/generate-look-sfeer.ts, opgeslagen in app_settings 'lookSfeer' als
 * { looks: { <slug>: [hero, ...galerij] } }). Krijgt voorrang boven de
 * product-sfeerbeelden, zodat een zakelijke look een stads-scène toont en een
 * gala een avond-scène, i.p.v. de categorie-mood. Leeg = nog niet gegenereerd.
 */
async function getLookSfeerStore(): Promise<Record<string, string[]>> {
  try {
    const db = getDb();
    const rows = await db.execute<{ data: unknown }>(sql`select data from app_settings where id = 'lookSfeer' limit 1`);
    const d = rows.rows[0]?.data as { looks?: Record<string, string[]> } | undefined;
    return d?.looks && typeof d.looks === "object" ? d.looks : {};
  } catch {
    return {};
  }
}

export async function getLookGallery(look: Look): Promise<{ hero: string; gallery: LookGalleryImage[] }> {
  // Door de portal expliciet ingestelde foto's (images[]) winnen ALTIJD — zo
  // matcht wat de beheerder instelt 1-op-1 met wat de site toont.
  if (look.images && look.images.length) {
    return {
      hero: look.images[0],
      gallery: look.images.slice(1).map((u) => ({ url: u, alt: `${look.title} — sfeerbeeld`, kind: "sfeer" as const })),
    };
  }
  const handles = [...new Set(look.hotspots.map((h) => h.handle))];
  if (!handles.length) return { hero: look.image, gallery: [] };
  const db = getDb();
  const rows = (
    await db.execute<{ handle: string; hg: string; l1: string; l2: string; l3: string; m1: string }>(sql`
      select p.handle, coalesce(p.attributes->>'hoofdgroep_omschrijving','') hg,
        split_part(p.lifestyle_image_url,'?',1) l1, split_part(p.lifestyle_image_url2,'?',1) l2,
        split_part(p.lifestyle_image_url3,'?',1) l3, split_part(p.model_image_url,'?',1) m1
      from products p
      where p.handle in (${sql.join(handles.map((h) => sql`${h}`), sql`, `)})
    `)
  ).rows;

  const order = (hg: string) => { const i = GARMENT_PRIORITY.indexOf(hg); return i < 0 ? 99 : i; };
  const sorted = [...rows].sort((a, b) => order(a.hg) - order(b.hg));

  const sfeer: LookGalleryImage[] = [];
  const model: LookGalleryImage[] = [];
  const seen = new Set<string>();
  for (const r of sorted) {
    for (const u of [r.l1, r.l2, r.l3]) {
      if (u && !seen.has(u)) { seen.add(u); sfeer.push({ url: u, alt: `${look.title} — sfeerbeeld`, kind: "sfeer" }); }
    }
    if (r.m1 && !seen.has(r.m1)) { seen.add(r.m1); model.push({ url: r.m1, alt: `${look.title} — op model`, kind: "model" }); }
  }
  // Gelegenheid-specifieke look-sfeerbeelden krijgen voorrang (hero + galerij).
  const own = (await getLookSfeerStore())[look.slug] || [];
  if (own.length) {
    const ownGallery: LookGalleryImage[] = own.slice(1).map((u) => ({ url: u, alt: `${look.title} — sfeerbeeld`, kind: "sfeer" }));
    const extra = [...sfeer, ...model].filter((g) => !own.includes(g.url));
    return { hero: own[0], gallery: [...ownGallery, ...extra].slice(0, 8) };
  }
  const hero = sfeer[0]?.url || look.image;
  const gallery = [...sfeer, ...model].filter((g) => g.url !== hero).slice(0, 8);
  return { hero, gallery };
}

/**
 * Sfeerbeeld-hero per look in ÉÉN query — voor de looks-overzichtspagina, zodat de
 * kaarten een sfeerbeeld tonen i.p.v. een studio-modelshot. Pakt per look het
 * sfeerbeeld van het hoofdgarment (pak/colbert eerst). Looks zonder sfeerbeeld
 * staan niet in de map → de pagina valt daar terug op look.image.
 */
export async function getLooksHeroes(looks: Look[]): Promise<Record<string, string>> {
  const allHandles = [...new Set(looks.flatMap((l) => l.hotspots.map((h) => h.handle)))];
  if (!allHandles.length) return {};
  const db = getDb();
  const rows = (
    await db.execute<{ handle: string; hg: string; l1: string }>(sql`
      select p.handle, coalesce(p.attributes->>'hoofdgroep_omschrijving','') hg, split_part(p.lifestyle_image_url, '?', 1) l1
      from products p
      where p.handle in (${sql.join(allHandles.map((h) => sql`${h}`), sql`, `)})
    `)
  ).rows;
  const byHandle = new Map(rows.map((r) => [r.handle, r]));
  const order = (hg: string) => { const i = GARMENT_PRIORITY.indexOf(hg); return i < 0 ? 99 : i; };
  const store = await getLookSfeerStore();
  const out: Record<string, string> = {};
  for (const look of looks) {
    // Gelegenheid-specifiek look-sfeerbeeld wint; anders het hoofdgarment-sfeerbeeld.
    if (store[look.slug]?.[0]) { out[look.slug] = store[look.slug][0]; continue; }
    const best = [...new Set(look.hotspots.map((h) => h.handle))]
      .map((h) => byHandle.get(h))
      .filter((r): r is { handle: string; hg: string; l1: string } => Boolean(r && r.l1))
      .sort((a, b) => order(a.hg) - order(b.hg))[0];
    if (best) out[look.slug] = best.l1;
  }
  return out;
}

/**
 * Kleurvarianten per look-product (zelfde variant_group_key, group_color_count>1).
 * Geeft per basis-handle de kiesbare kleuren met swatch + modelfoto, zodat de
 * look-detailpagina een kleur-switcher kan tonen die het product-/pakbeeld wisselt.
 */
export type LookColorOption = { handle: string; colorLabel: string; imageUrl: string; hex: string; gradient?: string; inStock: boolean };

export async function getLookColorOptions(handles: string[]): Promise<Record<string, LookColorOption[]>> {
  const uniq = [...new Set(handles.filter(Boolean))];
  if (!uniq.length) return {};
  const db = getDb();
  const rows = (
    await db.execute<{ base: string; handle: string; label: string; in_stock: boolean; m1: string; pack: string | null }>(sql`
      with base as (
        select handle, variant_group_key gk, group_color_count gc
        from products where handle in (${sql.join(uniq.map((h) => sql`${h}`), sql`, `)})
      )
      select b.handle base, p.handle, coalesce(p.variant_color_label,'') label, p.in_stock,
        split_part(p.model_image_url,'?',1) m1,
        (select pi.url from product_images pi where pi.product_id = p.id order by pi.position asc limit 1) pack
      from base b
      join products p on p.variant_group_key = b.gk
      where b.gk <> '' and b.gc > 1 and p.status = 'active' and p.has_image = true
      order by b.handle, p.in_stock desc, p.variant_color_label asc
    `)
  ).rows;

  const out: Record<string, LookColorOption[]> = {};
  for (const r of rows) {
    const sw = colorSwatch(r.label);
    (out[r.base] ||= []).push({
      handle: r.handle,
      colorLabel: r.label || "Variant",
      imageUrl: r.m1 || r.pack || "",
      hex: sw.hex,
      ...(sw.gradient ? { gradient: sw.gradient } : {}),
      inStock: r.in_stock,
    });
  }
  for (const k of Object.keys(out)) if (out[k].length < 2) delete out[k];
  return out;
}
