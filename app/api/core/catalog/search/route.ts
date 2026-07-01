import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { searchProducts } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/catalog/search — SNELLE fuzzy tekstzoek over de catalogus, rechtstreeks op
 * Neon. Voor het GETYPTE zoeken in de kassa (de tegenhanger van /catalog/lookup voor de
 * barcode-scan). Hergebruikt de gents.nl-zoekmachine (searchProducts: pg_trgm typo-tolerantie
 * + synoniemen + word_similarity) voor de RANKING, en hydrateert daarna per gevonden product
 * de variant-regels (sku/barcode/kleur/maat/prijs) in exact de "article-search"-vorm die de
 * kassa 1-op-1 gebruikt. Vervangt de trage in-memory Shopify-cache-scan.
 *
 * Body: { q, limit? }
 *   → { ok, results:[{ articleNumber, barcode, sku, productId, articleKey, title, color, size,
 *        price, variantId, image, images, productUrl, totalPieces:0, branchCount:0, branches:[] }] }
 *   (voorraadloos: stock volgt async via /api/store/article-stock, net als de barcode-lookup)
 * Auth: STORE_CORE_TOKEN of admin/STUDIO_API_TOKEN.
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { q?: string; limit?: number };
  try {
    body = (await req.json()) as { q?: string; limit?: number };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const q = String(body?.q || "").trim();
  const limit = Math.min(Math.max(Number(body?.limit) || 24, 1), 50);
  if (!q) return NextResponse.json({ ok: true, results: [] });

  // 1. Ranking via de bestaande gents.nl-zoek (typo-tolerantie + synoniemen + word_similarity).
  const cards = await searchProducts(q, limit).catch(() => []);
  const productIds = cards.map((c) => c.id).filter(Boolean);
  if (!productIds.length) return NextResponse.json({ ok: true, results: [] });
  const rank = new Map(productIds.map((id, i) => [id, i]));

  // 2. Hydrateer variant-regels in article-search-vorm (zelfde velden als /catalog/lookup).
  const rows = await getDb().execute<{
    product_id: string;
    handle: string;
    title: string;
    barcode: string;
    sku: string;
    size: string;
    color: string;
    price_cents: number;
    shopify_variant_id: string | null;
    srs_artikel_id: string;
    img: string | null;
  }>(sql`
    select v.product_id, p.handle, p.title, v.barcode, v.sku, v.size, v.color, v.price_cents,
      v.shopify_variant_id, v.srs_artikel_id,
      coalesce((select pi.url from product_images pi where pi.product_id = v.product_id order by pi.position asc limit 1), nullif(v.image_url, '')) img
    from product_variants v join products p on p.id = v.product_id
    where v.product_id in (${sql.join(
      productIds.map((id) => sql`${id}`),
      sql`, `,
    )})`);

  // Behoud de zoek-ranking (product-volgorde uit searchProducts), daarbinnen op maat.
  const ordered = rows.rows
    .slice()
    .sort(
      (a, b) =>
        (rank.get(a.product_id) ?? 9999) - (rank.get(b.product_id) ?? 9999) ||
        String(a.size).localeCompare(String(b.size)),
    );

  const results = ordered.map((r) => ({
    articleNumber: r.srs_artikel_id || r.sku || "",
    barcode: r.barcode || "",
    sku: r.sku || r.barcode || "",
    productId: r.product_id || "",
    articleKey: `${r.product_id || ""}||${String(r.color || "").toLowerCase()}`,
    title: r.title || "",
    color: r.color || "",
    size: r.size || "",
    price: ((Number(r.price_cents) || 0) / 100).toFixed(2),
    variantId: r.shopify_variant_id || "",
    image: r.img || "",
    images: r.img ? [r.img] : [],
    productUrl: r.handle ? `/product/${r.handle}` : "",
    totalPieces: 0,
    branchCount: 0,
    branches: [] as unknown[],
  }));

  return NextResponse.json({ ok: true, results });
}
