import { asc } from "drizzle-orm";
import { getDb } from "@/db";
import {
  products,
  productVariants,
  productImages,
  productCollections,
  collections,
} from "@/db/schema";

/**
 * Bouwt de products-cache in EXACT hetzelfde formaat als
 * storegents/lib/shopify-products-cache.js (blob: shopify-products/cache.json).
 *
 * ~44 modules in storegents lezen deze blob (artikel-zoeker, Bol-pipeline,
 * Channable-feed, mail-automations, beeldbank, mixmatch, ...). Zolang dit
 * schema identiek blijft, hoeven die niet aangepast te worden wanneer de
 * catalogusbron verschuift van Shopify naar deze database.
 *
 * Contract (geverifieerd tegen producer + alle consumers, juni 2026):
 *  - price is een STRING ("99.95"), geen number;
 *  - variantId/productId zijn Shopify-GID's — bevroren waarden uit de
 *    migratie; nieuwe producten zonder Shopify-verleden krijgen een
 *    gids-compatibel eigen ID (gid://gentsnext/...);
 *  - alle lookup-keys lowercase; index-maps last-wins, byNumericMetafield
 *    first-wins en bevat raw + leading-zero-gestripte sleutel;
 *  - arrays (images/collections/videos/numericMetafields) zijn nooit null;
 *  - alle strings getrimd; createdAt ISO 8601.
 */

type VariantEntry = {
  variantId: string;
  productId: string;
  title: string;
  productHandle: string;
  productUrl: string;
  image: string;
  images: string[];
  collections: string[];
  videos: { url: string; preview: string }[];
  description: string;
  descriptionPlain: string;
  color: string;
  size: string;
  sku: string;
  barcode: string;
  articleNumber: string;
  price: string;
  vendor: string;
  productType: string;
  srsArtikelId: string;
  srsRveArtikelnummer: string;
  subgroep: string;
  hoofdgroep: string;
  hoofdgroepOmschrijving: string;
  jaar: string;
  seizoen: string;
  materiaal: string;
  samenstelling: string;
  pasvorm: string;
  sluiting: string;
  mixAndMatch: string;
  createdAt: string;
  hasLongDescription: boolean;
  hasComplementary: boolean;
  numericMetafields: string[];
};

export type ProductsCachePayload = {
  refreshedAt: string;
  productCount: number;
  variantCount: number;
  bySku: Record<string, VariantEntry>;
  byBarcode: Record<string, VariantEntry>;
  bySrsArticleNumber: Record<string, VariantEntry>;
  bySrsArtikelId: Record<string, VariantEntry>;
  bySrsRveArtikelnummer: Record<string, VariantEntry>;
  byNumericMetafield: Record<string, VariantEntry>;
};

function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}

function stripHtml(html: string): string {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attrsOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export async function buildProductsCachePayload(): Promise<ProductsCachePayload> {
  const db = getDb();
  const siteBase = (process.env.PUBLIC_SITE_URL || "https://gents.nl").replace(/\/$/, "");

  const [allProducts, allVariants, allImages, allLinks, allCollections] = await Promise.all([
    db.select().from(products),
    db.select().from(productVariants).orderBy(asc(productVariants.position)),
    db.select().from(productImages).orderBy(asc(productImages.position)),
    db.select().from(productCollections),
    db.select().from(collections),
  ]);

  const imagesByProduct = new Map<string, string[]>();
  for (const img of allImages) {
    const list = imagesByProduct.get(img.productId) || [];
    if (list.length < 10) list.push(img.url);
    imagesByProduct.set(img.productId, list);
  }

  const collectionTitleById = new Map(allCollections.map((c) => [c.id, c.title]));
  const collectionsByProduct = new Map<string, string[]>();
  for (const link of allLinks) {
    const title = clean(collectionTitleById.get(link.collectionId));
    if (!title) continue;
    const list = collectionsByProduct.get(link.productId) || [];
    list.push(title);
    collectionsByProduct.set(link.productId, list);
  }

  const variantsByProduct = new Map<string, typeof allVariants>();
  for (const v of allVariants) {
    const list = variantsByProduct.get(v.productId) || [];
    list.push(v);
    variantsByProduct.set(v.productId, list);
  }

  const bySku: Record<string, VariantEntry> = {};
  const byBarcode: Record<string, VariantEntry> = {};
  const bySrsArticleNumber: Record<string, VariantEntry> = {};
  const bySrsArtikelId: Record<string, VariantEntry> = {};
  const bySrsRveArtikelnummer: Record<string, VariantEntry> = {};
  const byNumericMetafield: Record<string, VariantEntry> = {};
  let productCount = 0;
  let variantCount = 0;

  for (const product of allProducts) {
    productCount += 1;
    const attrs = attrsOf(product.attributes);
    const description = String(product.descriptionHtml || "");
    const descriptionPlain = stripHtml(description).slice(0, 500);
    const images = imagesByProduct.get(product.id) || [];
    const productCollectionTitles =
      collectionsByProduct.get(product.id) ||
      (Array.isArray(attrs._collectionTitles) ? (attrs._collectionTitles as string[]).map(clean).filter(Boolean) : []);
    const videos = Array.isArray(attrs._videos)
      ? (attrs._videos as { url?: unknown; preview?: unknown }[])
          .map((v) => ({ url: clean(v?.url), preview: clean(v?.preview) }))
          .filter((v) => v.url)
      : [];
    const productHandle = clean(product.handle);
    const productUrl = productHandle ? `${siteBase}/products/${productHandle}` : "";
    const productGid = clean(product.shopifyProductId) || `gid://gentsnext/Product/${product.id}`;

    // Numerieke metafield-values (3-12 cijfers) voor de wide-match in
    // article-search — zelfde regel als de bron.
    const numericMetafields: string[] = [];
    for (const [key, val] of Object.entries(attrs)) {
      if (key.startsWith("_")) continue;
      const trimmed = clean(val);
      if (/^\d{3,12}$/.test(trimmed)) numericMetafields.push(trimmed);
    }
    // Round-trip vanuit de bootstrap-import: numerieke metafields waarvan de
    // oorspronkelijke key onbekend is, bewaard als attrs._numericMetafields.
    if (Array.isArray(attrs._numericMetafields)) {
      for (const v of attrs._numericMetafields as unknown[]) {
        const trimmed = clean(v);
        if (/^\d{3,12}$/.test(trimmed) && !numericMetafields.includes(trimmed)) {
          numericMetafields.push(trimmed);
        }
      }
    }

    const shared = {
      title: clean(product.title),
      productHandle,
      productUrl,
      images,
      collections: productCollectionTitles,
      videos,
      description,
      descriptionPlain,
      vendor: clean(product.vendor),
      productType: clean(product.productType),
      subgroep: clean(attrs["subgroep"]),
      hoofdgroep: clean(attrs["hoofdgroep"]),
      hoofdgroepOmschrijving: clean(attrs["hoofdgroep_omschrijving"]),
      jaar: clean(attrs["jaar"]),
      seizoen: clean(attrs["seizoen"]),
      materiaal: clean(attrs["materiaal"]),
      samenstelling: clean(attrs["samenstelling_materiaal"] || attrs["samenstelling"]),
      pasvorm: clean(attrs["pasvorm"]),
      sluiting: clean(attrs["sluiting"]),
      mixAndMatch: clean(attrs["mix_and_match"]),
      createdAt: product.sourceCreatedAt ? product.sourceCreatedAt.toISOString() : "",
      // De theme gebruikt historisch de typo-key `long_deescription`; beide tellen.
      hasLongDescription: Boolean(clean(attrs["long_description"] || attrs["long_deescription"])),
      hasComplementary: Boolean(clean(attrs["complementary_products"])),
      numericMetafields,
    };

    for (const variant of variantsByProduct.get(product.id) || []) {
      variantCount += 1;
      const featured = images[0] || "";
      const entry: VariantEntry = {
        variantId: clean(variant.shopifyVariantId) || `gid://gentsnext/ProductVariant/${variant.id}`,
        productId: productGid,
        image: clean(variant.imageUrl) || featured,
        color: clean(variant.color),
        size: clean(variant.size),
        sku: clean(variant.sku),
        barcode: clean(variant.barcode),
        articleNumber: clean(variant.sku),
        price: (variant.priceCents / 100).toFixed(2),
        srsArtikelId: clean(variant.srsArtikelId) || clean(attrs["artikel_id"]),
        srsRveArtikelnummer: clean(variant.srsRveArtikelnummer) || clean(attrs["rve_artikelnummer"]),
        ...shared,
      };

      if (entry.sku) bySku[entry.sku.toLowerCase()] = entry;
      if (entry.barcode) byBarcode[entry.barcode.toLowerCase()] = entry;
      if (entry.sku) bySrsArticleNumber[entry.sku.toLowerCase()] = entry;
      if (entry.srsArtikelId) bySrsArtikelId[entry.srsArtikelId.toLowerCase()] = entry;
      if (entry.srsRveArtikelnummer) bySrsRveArtikelnummer[entry.srsRveArtikelnummer.toLowerCase()] = entry;
      for (const raw of entry.numericMetafields) {
        const key = raw.toLowerCase();
        const stripped = key.replace(/^0+(?=\d)/, "");
        if (!byNumericMetafield[key]) byNumericMetafield[key] = entry;
        if (stripped !== key && !byNumericMetafield[stripped]) byNumericMetafield[stripped] = entry;
      }
    }
  }

  return {
    refreshedAt: new Date().toISOString(),
    productCount,
    variantCount,
    bySku,
    byBarcode,
    bySrsArticleNumber,
    bySrsArtikelId,
    bySrsRveArtikelnummer,
    byNumericMetafield,
  };
}
