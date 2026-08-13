import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { products, productVariants, productImages } from "@/db/schema";
import { stockForSkus } from "@/lib/stock";
import { sortSizes } from "@/lib/sizing";
import { BRANCH_CITY } from "@/lib/fulfillment-config";
import { pickupInfoByCity } from "@/lib/stores";

/**
 * Pak-samenstellen (mix & match): colbert + pantalon (+ gilet) worden los
 * verkocht in dezelfde maat; prijs = som. De koppeling zit in de SRS-artikel_id:
 * strip de rol-prefix (COL/PAN/GIL) en de rest is de gedeelde stijlcode.
 *   COL-H61747  ↔  PAN-H61747   → zelfde pak
 *   COLYG-90913 ↔  PANYG-90913
 * (De ~38 m-m-colberts met het 52079/318-formaat hebben geen broek-match in de
 *  data en verschijnen daarom niet als samenstelbaar pak.)
 */

const PREFIXES = [
  "COLBERT", "PANTALON", "BROEK", "GILET",
  "DBCOL", "DPAN", "DGIL", "DCOL",
  "COL", "JAS", "PAN", "BRO", "TRO", "GIL", "VES", "VST", "WAI", "BLZ",
  "JK", "TS", "GL",
].sort((a, b) => b.length - a.length);

const ROLE_BY_HG: Record<string, "colbert" | "broek" | "gilet"> = {
  Colberts: "colbert",
  Broeken: "broek",
  Gilets: "gilet",
};

export function styleCode(artikelId: string): string {
  let a = String(artikelId || "").trim().toUpperCase();
  for (const p of PREFIXES) {
    if (a.startsWith(p)) {
      a = a.slice(p.length);
      break;
    }
  }
  return a.replace(/^[-\s]+/, "");
}

export type SuitRole = "colbert" | "broek" | "gilet";

/**
 * De AI-media naast de packshot. Deze stukken hebben op hun eigen PDP allang een
 * modelfoto/sfeerbeeld/video, maar de samensteller vroeg ze niet op en toonde dus
 * alleen een platte packshot van het colbert.
 */
type PieceMedia = {
  /** Modelfoto (studio, 4:5) — leidt de galerij, net als op de PDP. */
  modelImage: string;
  /** Sfeerbeeld op locatie. */
  lifestyleImage: string;
  /** Tweede modelfoto/editorial (model_image_url2). */
  modelImage2: string;
  video: string;
};

type RawPiece = {
  id: string;
  handle: string;
  title: string;
  role: SuitRole;
  image: string;
  minPrice: number;
} & PieceMedia & { fit: string; color: string };

export type SuitCard = {
  code: string;
  colbertHandle: string;
  title: string;
  image: string;
  /** Tegel-beeld: modelfoto als die er is, anders de packshot. */
  tileImage: string;
  fromCents: number; // colbert + broek (2-delig)
  threePiece: boolean;
  /** Facetten voor de filterbalk (uit het colbert). */
  fit: string;
  color: string;
};

async function fetchPieces(): Promise<Map<string, RawPiece[]>> {
  const db = getDb();
  const rows = await db.execute<{
    id: string;
    handle: string;
    title: string;
    hg: string;
    art: string;
    image: string | null;
    min_price: number | null;
    model_image: string | null;
    model_image2: string | null;
    lifestyle_image: string | null;
    video: string | null;
    fit: string | null;
    color: string | null;
  }>(sql`
    select p.id, p.handle, p.title,
           p.attributes ->> 'hoofdgroep_omschrijving' as hg,
           p.attributes ->> 'artikel_id' as art,
           (select url from ${productImages} pi where pi.product_id = p.id order by position limit 1) as image,
           (select min(price_cents) from ${productVariants} v where v.product_id = p.id) as min_price,
           p.model_image_url as model_image,
           p.model_image_url2 as model_image2,
           p.lifestyle_image_url as lifestyle_image,
           p.model_video_url as video,
           p.attributes ->> 'pasvorm' as fit,
           p.variant_color_label as color
    from ${products} p
    where p.status = 'active'
      and p.attributes ->> 'mix_and_match' = 'Ja'
      and p.attributes ->> 'hoofdgroep_omschrijving' in ('Colberts','Broeken','Gilets')
      and coalesce(p.attributes ->> 'artikel_id', '') <> ''
      -- Dameskleding staat óók als hoofdgroep "Colberts" in de data, waardoor er een
      -- damesblazer in de herenpak-samensteller stond. Niet op 'Heren' filteren:
      -- bij een deel van de heren-artikelen is 'geslacht' leeg.
      and coalesce(p.attributes ->> 'geslacht', '') <> 'Dames'
  `);

  const groups = new Map<string, RawPiece[]>();
  for (const r of rows.rows) {
    const role = ROLE_BY_HG[r.hg];
    const code = styleCode(r.art);
    if (!role || !code) continue;
    const piece: RawPiece = {
      id: r.id,
      handle: r.handle,
      title: r.title,
      role,
      image: r.image || "",
      minPrice: Number(r.min_price ?? 0),
      modelImage: r.model_image || "",
      modelImage2: r.model_image2 || "",
      lifestyleImage: r.lifestyle_image || "",
      video: r.video || "",
      fit: r.fit || "",
      color: r.color || "",
    };
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code)!.push(piece);
  }
  return groups;
}

function pick(pieces: RawPiece[], role: SuitRole): RawPiece | undefined {
  return pieces.find((p) => p.role === role);
}

/** Lichtgewicht lijst van samenstelbare pakken (voor de overzichtspagina). */
export async function listSuits(): Promise<SuitCard[]> {
  const groups = await fetchPieces();
  const suits: SuitCard[] = [];
  for (const [code, pieces] of groups) {
    const colbert = pick(pieces, "colbert");
    const broek = pick(pieces, "broek");
    if (!colbert || !broek) continue;
    const gilet = pick(pieces, "gilet");
    suits.push({
      code,
      colbertHandle: colbert.handle,
      title: colbert.title.replace(/^colbert[\s-]*/i, "").trim() || colbert.title,
      image: colbert.image,
      // Model eerst, net als op de PLP: een pak op een mens verkoopt beter dan een
      // los colbert op wit. Valt terug op de packshot als er nog geen modelfoto is.
      tileImage: colbert.modelImage || colbert.lifestyleImage || colbert.image,
      fit: colbert.fit,
      color: colbert.color,
      fromCents: colbert.minPrice + broek.minPrice,
      threePiece: Boolean(gilet),
    });
  }
  return suits.sort((a, b) => a.fromCents - b.fromCents);
}

/** Snelle koppeling: geef voor een willekeurig MixMatch-stuk (colbert/broek/gilet)
 *  de handles van het hele pak terug. Null als 't geen samenstelbaar pak is. */
export async function getSuitPieceHandles(handle: string): Promise<{ colbert?: string; broek?: string; gilet?: string } | null> {
  const groups = await fetchPieces();
  for (const [, pieces] of groups) {
    if (pieces.some((p) => p.handle === handle)) {
      const out: { colbert?: string; broek?: string; gilet?: string } = {};
      for (const p of pieces) out[p.role] = p.handle;
      // Alleen een "pak" als er minstens colbert + broek is.
      return out.colbert && out.broek ? out : null;
    }
  }
  return null;
}

export type SuitPieceDetail = {
  role: SuitRole;
  handle: string;
  title: string;
  image: string;
  /** Modelfoto/sfeerbeeld/video van dít onderdeel — voor de galerij naast de packshot. */
  media: PieceMedia;
  /** maatLabel → { size, sku, priceCents, qty (online), known, winkelvoorraad } */
  sizes: {
    sizeLabel: string;
    size: string;
    sku: string;
    priceCents: number;
    qty: number;
    known: boolean;
    branches: { store: string; qty: number; openNow: boolean; openLabel: string }[];
  }[];
};

export type SuitDetail = {
  code: string;
  pieces: SuitPieceDetail[];
  /** Attributen van het colbert (voor materiaal/onderhoud/pasvorm op de samensteller). */
  attributes: Record<string, unknown>;
};

/** Volledig pak (incl. maten + voorraad) voor de samensteller, op colbert-handle. */
export async function getSuitByColbertHandle(handle: string): Promise<SuitDetail | null> {
  const db = getDb();
  const groups = await fetchPieces();
  let foundCode: string | null = null;
  let pieces: RawPiece[] = [];
  for (const [code, ps] of groups) {
    if (ps.some((p) => p.role === "colbert" && p.handle === handle)) {
      foundCode = code;
      pieces = ps;
      break;
    }
  }
  if (!foundCode || !pieces.some((p) => p.role === "broek")) return null;

  const order: SuitRole[] = ["colbert", "broek", "gilet"];
  const chosen = order.map((role) => pick(pieces, role)).filter(Boolean) as RawPiece[];

  const variantRows = await db
    .select({
      productId: productVariants.productId,
      size: productVariants.size,
      sizeLabel: productVariants.sizeLabel,
      sku: productVariants.sku,
      priceCents: productVariants.priceCents,
      position: productVariants.position,
    })
    .from(productVariants)
    .where(inArray(productVariants.productId, chosen.map((p) => p.id)))
    .orderBy(asc(productVariants.position));

  const stockMap = await stockForSkus(variantRows.map((v) => v.sku).filter(Boolean));
  const hasStock = stockMap.size > 0;

  const byProduct = new Map<string, SuitPieceDetail["sizes"]>();
  for (const v of variantRows) {
    if (!v.size) continue;
    const list = byProduct.get(v.productId) || [];
    const st = v.sku ? stockMap.get(v.sku) : undefined;
    list.push({
      sizeLabel: v.sizeLabel,
      size: v.size,
      sku: v.sku,
      priceCents: v.priceCents,
      qty: st?.online ?? 0,
      known: hasStock && Boolean(v.sku),
      // Winkelvoorraad (click & collect) — alleen retailwinkels, open eerst.
      branches:
        st?.byBranch
          .filter((b) => Boolean(BRANCH_CITY[b.branchId]))
          .map((b) => {
            const city = BRANCH_CITY[b.branchId];
            const info = pickupInfoByCity(city);
            return { store: b.store, qty: b.qty, openNow: info?.openNow ?? false, openLabel: info?.label ?? "" };
          })
          .sort((a, b) => Number(b.openNow) - Number(a.openNow) || b.qty - a.qty) ?? [],
    });
    byProduct.set(v.productId, list);
  }

  const detail: SuitPieceDetail[] = chosen.map((p) => ({
    role: p.role,
    handle: p.handle,
    title: p.title,
    image: p.image,
    media: {
      modelImage: p.modelImage,
      modelImage2: p.modelImage2,
      lifestyleImage: p.lifestyleImage,
      video: p.video,
    },
    sizes: sortSizes(byProduct.get(p.id) || []),
  }));

  // Attributen van het colbert (materiaal/onderhoud/pasvorm) voor de samensteller.
  const colbertId = chosen.find((p) => p.role === "colbert")?.id;
  let attributes: Record<string, unknown> = {};
  if (colbertId) {
    const ar = await db.execute<{ attrs: Record<string, unknown> }>(sql`select attributes as attrs from ${products} where id = ${colbertId} limit 1`);
    attributes = ar.rows[0]?.attrs ?? {};
  }

  return { code: foundCode, pieces: detail, attributes };
}
