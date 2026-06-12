import "@/lib/load-env";
import { readFileSync } from "node:fs";
import { upsertCatalog, slugify, type ImportProduct } from "@/lib/catalog-import";

/**
 * Bootstrap-import vanuit de bestaande storegents products-cache
 * (shopify-products/cache.json). Lossy (geen SEO-velden, max 10 foto's,
 * beschrijving mogelijk afgekapt in descriptionPlain — descriptionHtml is wél
 * volledig) maar genoeg om vandaag een gevulde catalogus-DB te hebben.
 * De volledige migratie loopt daarna via import:shopify (GraphQL bulk).
 *
 * Gebruik:
 *   npm run import:cache -- --file ./data/cache.json
 *   npm run import:cache -- --url https://<blob-url>/shopify-products/cache.json
 *   (of env STOREGENTS_PRODUCTS_CACHE_URL)
 */

type CacheEntry = {
  variantId: string;
  productId: string;
  title: string;
  productHandle: string;
  image: string;
  images: string[];
  collections: string[];
  videos: { url: string; preview: string }[];
  description: string;
  color: string;
  size: string;
  sku: string;
  barcode: string;
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

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] || null : null;
}

function toCents(price: string): number {
  const parsed = Number.parseFloat(String(price || "0").replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function nonEmpty(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

async function loadPayload(): Promise<Record<string, Record<string, CacheEntry>>> {
  const file = arg("--file");
  const url = arg("--url") || process.env.STOREGENTS_PRODUCTS_CACHE_URL;
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  if (url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Cache-download mislukte: HTTP ${res.status}`);
    return res.json();
  }
  throw new Error("Geef --file <pad> of --url <blob-url> (of zet STOREGENTS_PRODUCTS_CACHE_URL).");
}

async function main() {
  const payload = await loadPayload();

  // Union van alle index-maps → unieke varianten op variantId.
  const entries = new Map<string, CacheEntry>();
  const maps = [
    "bySku",
    "byBarcode",
    "bySrsArticleNumber",
    "bySrsArtikelId",
    "bySrsRveArtikelnummer",
    "byNumericMetafield",
  ] as const;
  for (const mapName of maps) {
    for (const entry of Object.values(payload[mapName] || {})) {
      if (entry?.variantId && !entries.has(entry.variantId)) entries.set(entry.variantId, entry);
    }
  }

  // Groepeer per product.
  const byProduct = new Map<string, CacheEntry[]>();
  let skipped = 0;
  for (const entry of entries.values()) {
    if (!entry.productId || !entry.productHandle || !entry.title) {
      skipped += 1;
      continue;
    }
    const list = byProduct.get(entry.productId) || [];
    list.push(entry);
    byProduct.set(entry.productId, list);
  }

  const items: ImportProduct[] = [];
  for (const [productId, variants] of byProduct) {
    const first = variants[0];
    items.push({
      shopifyProductId: productId,
      handle: first.productHandle,
      title: first.title,
      descriptionHtml: first.description || "",
      vendor: first.vendor || "",
      productType: first.productType || "",
      status: "active",
      seoTitle: "",
      seoDescription: "",
      attributes: nonEmpty({
        artikel_id: first.srsArtikelId,
        rve_artikelnummer: first.srsRveArtikelnummer,
        subgroep: first.subgroep,
        hoofdgroep: first.hoofdgroep,
        hoofdgroep_omschrijving: first.hoofdgroepOmschrijving,
        jaar: first.jaar,
        seizoen: first.seizoen,
        materiaal: first.materiaal,
        samenstelling_materiaal: first.samenstelling,
        pasvorm: first.pasvorm,
        sluiting: first.sluiting,
        mix_and_match: first.mixAndMatch,
        long_description: first.hasLongDescription ? "1" : "",
        complementary_products: first.hasComplementary ? "1" : "",
        _collectionTitles: first.collections || [],
        _videos: first.videos || [],
        _numericMetafields: first.numericMetafields || [],
      }),
      sourceCreatedAt: first.createdAt || null,
      publishedAt: null,
      images: (first.images || []).map((url) => ({ url, alt: "" })),
      collections: (first.collections || []).map((title) => ({
        shopifyCollectionId: null,
        handle: slugify(title),
        title,
      })),
      variants: variants.map((v, i) => ({
        shopifyVariantId: v.variantId,
        sku: v.sku || "",
        barcode: v.barcode || "",
        priceCents: toCents(v.price),
        compareAtCents: null,
        color: v.color || "",
        size: v.size || "",
        position: i,
        imageUrl: v.image || "",
        srsArtikelId: v.srsArtikelId || "",
        srsRveArtikelnummer: v.srsRveArtikelnummer || "",
      })),
    });
  }

  console.log(
    `Cache gelezen: ${entries.size} varianten, ${items.length} producten` +
      (skipped ? ` (${skipped} varianten zonder handle/titel overgeslagen)` : "")
  );
  // preserveExisting: dit lossy pad mag rijkere bulk-data nooit degraderen.
  const stats = await upsertCatalog(items, { preserveExisting: true });
  console.log("Import klaar:", stats);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
