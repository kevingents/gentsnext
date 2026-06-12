import { and, asc, count, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  products,
  productVariants,
  productImages,
  productCollections,
  collections,
} from "@/db/schema";

/** Leeslaag voor de storefront — alle catalogus-queries op één plek. */

export type ProductCardData = {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  imageUrl: string;
  imageAlt: string;
  minPriceCents: number;
  hasPriceRange: boolean;
};

export async function listCollections() {
  const db = getDb();
  return db
    .select({
      id: collections.id,
      handle: collections.handle,
      title: collections.title,
      descriptionHtml: collections.descriptionHtml,
    })
    .from(collections)
    .orderBy(asc(collections.position), asc(collections.title));
}

export async function getCollectionByHandle(handle: string) {
  const db = getDb();
  const rows = await db.select().from(collections).where(eq(collections.handle, handle)).limit(1);
  return rows[0] ?? null;
}

async function buildProductCards(
  base: { id: string; handle: string; title: string; vendor: string }[]
): Promise<ProductCardData[]> {
  const db = getDb();
  const ids = base.map((p) => p.id);
  if (!ids.length) return [];

  const [images, variants] = await Promise.all([
    db
      .select({
        productId: productImages.productId,
        url: productImages.url,
        alt: productImages.alt,
        position: productImages.position,
      })
      .from(productImages)
      .where(inArray(productImages.productId, ids))
      .orderBy(asc(productImages.position)),
    db
      .select({
        productId: productVariants.productId,
        priceCents: productVariants.priceCents,
      })
      .from(productVariants)
      .where(inArray(productVariants.productId, ids)),
  ]);

  const firstImage = new Map<string, { url: string; alt: string }>();
  for (const img of images) {
    if (!firstImage.has(img.productId)) firstImage.set(img.productId, { url: img.url, alt: img.alt });
  }
  const priceRange = new Map<string, { min: number; max: number }>();
  for (const v of variants) {
    const range = priceRange.get(v.productId);
    if (!range) priceRange.set(v.productId, { min: v.priceCents, max: v.priceCents });
    else {
      range.min = Math.min(range.min, v.priceCents);
      range.max = Math.max(range.max, v.priceCents);
    }
  }

  return base.map((p) => {
    const img = firstImage.get(p.id);
    const range = priceRange.get(p.id);
    return {
      id: p.id,
      handle: p.handle,
      title: p.title,
      vendor: p.vendor,
      imageUrl: img?.url || "",
      imageAlt: img?.alt || p.title,
      minPriceCents: range?.min ?? 0,
      hasPriceRange: Boolean(range && range.min !== range.max),
    };
  });
}

export async function getCollectionProducts(collectionId: string, page: number, perPage: number) {
  const db = getDb();
  const baseQuery = and(
    eq(productCollections.collectionId, collectionId),
    eq(products.status, "active")
  );

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: products.id,
        handle: products.handle,
        title: products.title,
        vendor: products.vendor,
      })
      .from(productCollections)
      .innerJoin(products, eq(products.id, productCollections.productId))
      .where(baseQuery)
      .orderBy(asc(productCollections.position), asc(products.title))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db
      .select({ total: count() })
      .from(productCollections)
      .innerJoin(products, eq(products.id, productCollections.productId))
      .where(baseQuery),
  ]);

  return {
    items: await buildProductCards(rows),
    total: totals[0]?.total ?? 0,
  };
}

export async function getProductByHandle(handle: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.handle, handle), eq(products.status, "active")))
    .limit(1);
  const product = rows[0];
  if (!product) return null;

  const [variants, images, links] = await Promise.all([
    db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, product.id))
      .orderBy(asc(productVariants.position)),
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, product.id))
      .orderBy(asc(productImages.position)),
    db
      .select({ handle: collections.handle, title: collections.title })
      .from(productCollections)
      .innerJoin(collections, eq(collections.id, productCollections.collectionId))
      .where(eq(productCollections.productId, product.id))
      .orderBy(asc(productCollections.position)),
  ]);

  return { product, variants, images, collections: links };
}

export async function listProductHandles(limit = 50000) {
  const db = getDb();
  return db
    .select({ handle: products.handle, updatedAt: products.updatedAt })
    .from(products)
    .where(eq(products.status, "active"))
    .limit(limit);
}
