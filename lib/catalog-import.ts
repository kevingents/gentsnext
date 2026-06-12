import { inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  products,
  productVariants,
  priceHistory,
  collections,
  productCollections,
  productImages,
} from "@/db/schema";

/**
 * Gedeelde upsert-logica voor de twee importpaden:
 *  - scripts/import-from-cache.ts  (bootstrap vanuit de storegents-cache, lossy)
 *  - scripts/import-shopify-bulk.ts (volledige GraphQL Bulk-export)
 *
 * Idempotent: opnieuw draaien werkt alles bij op basis van de bevroren
 * Shopify-ID's. Prijswijzigingen leveren automatisch een price_history-rij op
 * (Omnibus 30-dagen-laagste).
 */

export type ImportVariant = {
  shopifyVariantId: string;
  sku: string;
  barcode: string;
  priceCents: number;
  compareAtCents: number | null;
  color: string;
  size: string;
  position: number;
  imageUrl: string;
  srsArtikelId: string;
  srsRveArtikelnummer: string;
  attributes?: Record<string, unknown>;
};

export type ImportCollection = {
  shopifyCollectionId: string | null;
  handle: string;
  title: string;
  descriptionHtml?: string;
  rules?: unknown;
};

export type ImportProduct = {
  shopifyProductId: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  status: string;
  seoTitle: string;
  seoDescription: string;
  attributes: Record<string, unknown>;
  sourceCreatedAt: string | null;
  publishedAt: string | null;
  images: { url: string; alt: string }[];
  collections: ImportCollection[];
  variants: ImportVariant[];
};

const CHUNK = 100;

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function upsertCatalog(items: ImportProduct[]) {
  const db = getDb();
  const stats = {
    products: 0,
    variants: 0,
    collections: 0,
    images: 0,
    priceHistoryRows: 0,
  };

  /* ── 1. Collecties ───────────────────────────────────────────────────── */
  const collectionByHandle = new Map<string, ImportCollection>();
  for (const item of items) {
    for (const col of item.collections) {
      if (col.handle && !collectionByHandle.has(col.handle)) {
        collectionByHandle.set(col.handle, col);
      }
    }
  }
  const collectionIdByHandle = new Map<string, string>();
  for (const batch of chunked([...collectionByHandle.values()], CHUNK)) {
    const rows = await db
      .insert(collections)
      .values(
        batch.map((c) => ({
          handle: c.handle,
          title: c.title,
          descriptionHtml: c.descriptionHtml || "",
          shopifyCollectionId: c.shopifyCollectionId,
          rules: c.rules ?? null,
        }))
      )
      .onConflictDoUpdate({
        target: collections.handle,
        set: {
          title: sql`excluded.title`,
          shopifyCollectionId: sql`excluded.shopify_collection_id`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: collections.id, handle: collections.handle });
    for (const row of rows) collectionIdByHandle.set(row.handle, row.id);
    stats.collections += rows.length;
  }

  /* ── 2. Producten ────────────────────────────────────────────────────── */
  const productIdByShopifyId = new Map<string, string>();
  for (const batch of chunked(items, CHUNK)) {
    const rows = await db
      .insert(products)
      .values(
        batch.map((p) => ({
          handle: p.handle,
          title: p.title,
          descriptionHtml: p.descriptionHtml,
          vendor: p.vendor,
          productType: p.productType,
          status: p.status,
          seoTitle: p.seoTitle,
          seoDescription: p.seoDescription,
          shopifyProductId: p.shopifyProductId,
          attributes: p.attributes,
          sourceCreatedAt: toDate(p.sourceCreatedAt),
          publishedAt: toDate(p.publishedAt),
        }))
      )
      .onConflictDoUpdate({
        target: products.shopifyProductId,
        set: {
          handle: sql`excluded.handle`,
          title: sql`excluded.title`,
          descriptionHtml: sql`excluded.description_html`,
          vendor: sql`excluded.vendor`,
          productType: sql`excluded.product_type`,
          status: sql`excluded.status`,
          seoTitle: sql`excluded.seo_title`,
          seoDescription: sql`excluded.seo_description`,
          attributes: sql`excluded.attributes`,
          sourceCreatedAt: sql`excluded.source_created_at`,
          publishedAt: sql`excluded.published_at`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: products.id, shopifyProductId: products.shopifyProductId });
    for (const row of rows) {
      if (row.shopifyProductId) productIdByShopifyId.set(row.shopifyProductId, row.id);
    }
    stats.products += rows.length;
  }

  /* ── 3. Afbeeldingen + collectie-koppelingen (delete + insert) ───────── */
  const allProductIds = [...productIdByShopifyId.values()];
  for (const batch of chunked(allProductIds, 500)) {
    await db.delete(productImages).where(inArray(productImages.productId, batch));
    await db.delete(productCollections).where(inArray(productCollections.productId, batch));
  }

  const imageRows: (typeof productImages.$inferInsert)[] = [];
  const linkRows: (typeof productCollections.$inferInsert)[] = [];
  for (const item of items) {
    const productId = productIdByShopifyId.get(item.shopifyProductId);
    if (!productId) continue;
    item.images.forEach((img, i) => {
      if (img.url) imageRows.push({ productId, url: img.url, alt: img.alt || "", position: i });
    });
    item.collections.forEach((col, i) => {
      const collectionId = collectionIdByHandle.get(col.handle);
      if (collectionId) linkRows.push({ productId, collectionId, position: i });
    });
  }
  for (const batch of chunked(imageRows, 500)) {
    await db.insert(productImages).values(batch);
    stats.images += batch.length;
  }
  for (const batch of chunked(linkRows, 500)) {
    await db.insert(productCollections).values(batch);
  }

  /* ── 4. Varianten + prijshistorie ────────────────────────────────────── */
  const allVariantShopifyIds = items.flatMap((p) =>
    p.variants.map((v) => v.shopifyVariantId).filter(Boolean)
  );
  const previousPrice = new Map<string, { priceCents: number; compareAtCents: number | null }>();
  for (const batch of chunked(allVariantShopifyIds, 500)) {
    const rows = await db
      .select({
        shopifyVariantId: productVariants.shopifyVariantId,
        priceCents: productVariants.priceCents,
        compareAtCents: productVariants.compareAtCents,
      })
      .from(productVariants)
      .where(inArray(productVariants.shopifyVariantId, batch));
    for (const row of rows) {
      if (row.shopifyVariantId) {
        previousPrice.set(row.shopifyVariantId, {
          priceCents: row.priceCents,
          compareAtCents: row.compareAtCents,
        });
      }
    }
  }

  const variantRows: (typeof productVariants.$inferInsert)[] = [];
  for (const item of items) {
    const productId = productIdByShopifyId.get(item.shopifyProductId);
    if (!productId) continue;
    for (const v of item.variants) {
      variantRows.push({
        productId,
        sku: v.sku,
        barcode: v.barcode,
        position: v.position,
        size: v.size,
        color: v.color,
        priceCents: v.priceCents,
        compareAtCents: v.compareAtCents,
        srsArtikelId: v.srsArtikelId,
        srsRveArtikelnummer: v.srsRveArtikelnummer,
        shopifyVariantId: v.shopifyVariantId,
        imageUrl: v.imageUrl,
        attributes: v.attributes ?? {},
      });
    }
  }

  const historyRows: (typeof priceHistory.$inferInsert)[] = [];
  for (const batch of chunked(variantRows, CHUNK)) {
    const rows = await db
      .insert(productVariants)
      .values(batch)
      .onConflictDoUpdate({
        target: productVariants.shopifyVariantId,
        set: {
          productId: sql`excluded.product_id`,
          sku: sql`excluded.sku`,
          barcode: sql`excluded.barcode`,
          position: sql`excluded.position`,
          size: sql`excluded.size`,
          color: sql`excluded.color`,
          priceCents: sql`excluded.price_cents`,
          compareAtCents: sql`excluded.compare_at_cents`,
          srsArtikelId: sql`excluded.srs_artikel_id`,
          srsRveArtikelnummer: sql`excluded.srs_rve_artikelnummer`,
          imageUrl: sql`excluded.image_url`,
          attributes: sql`excluded.attributes`,
          updatedAt: sql`now()`,
        },
      })
      .returning({
        id: productVariants.id,
        shopifyVariantId: productVariants.shopifyVariantId,
        priceCents: productVariants.priceCents,
        compareAtCents: productVariants.compareAtCents,
      });
    stats.variants += rows.length;

    for (const row of rows) {
      const prev = row.shopifyVariantId ? previousPrice.get(row.shopifyVariantId) : undefined;
      const changed =
        !prev ||
        prev.priceCents !== row.priceCents ||
        (prev.compareAtCents ?? null) !== (row.compareAtCents ?? null);
      if (changed) {
        historyRows.push({
          variantId: row.id,
          priceCents: row.priceCents,
          compareAtCents: row.compareAtCents,
        });
      }
    }
  }
  for (const batch of chunked(historyRows, 500)) {
    await db.insert(priceHistory).values(batch);
    stats.priceHistoryRows += batch.length;
  }

  return stats;
}
