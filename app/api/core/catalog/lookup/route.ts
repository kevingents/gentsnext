import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/catalog/lookup — SNELLE catalogus-lookup rechtstreeks uit Neon
 * (geïndexeerd op barcode / sku / srs_artikel_id). Vervangt de trage Shopify-cache-blob
 * voor de kassa-barcode-scan: een geïndexeerde query = ~5-20ms i.p.v. seconden.
 *
 * Body: { code } (bv. een gescande EAN/SKU)
 *   → { ok, results:[{ articleNumber, barcode, sku, title, color, size, price,
 *        variantId, image, images, totalPieces:0, branchCount:0, branches:[] }] }
 *   (zelfde vorm als article-search, zodat de kassa 'm 1-op-1 gebruikt; voorraad volgt
 *    async via /api/store/article-stock)
 * Auth: STORE_CORE_TOKEN of admin/STUDIO_API_TOKEN.
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { code?: string };
  try {
    body = (await req.json()) as { code?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const code = String(body?.code || "").trim().toLowerCase();
  if (!code) return NextResponse.json({ ok: true, results: [] });

  const db = getDb();
  const rows = await db.execute<{
    barcode: string;
    sku: string;
    title: string;
    size: string;
    color: string;
    price_cents: number;
    shopify_variant_id: string | null;
    srs_artikel_id: string;
    img: string | null;
  }>(sql`
    select v.barcode, v.sku, p.title, v.size, v.color, v.price_cents, v.shopify_variant_id, v.srs_artikel_id,
      coalesce((select pi.url from product_images pi where pi.product_id = v.product_id order by pi.position asc limit 1), nullif(v.image_url, '')) img
    from product_variants v join products p on p.id = v.product_id
    where lower(v.barcode) = ${code} or lower(v.sku) = ${code} or lower(v.srs_artikel_id) = ${code}
    limit 1`);

  const results = rows.rows.map((r) => ({
    articleNumber: r.srs_artikel_id || r.sku || "",
    barcode: r.barcode || "",
    sku: r.sku || r.barcode || "",
    title: r.title || "",
    color: r.color || "",
    size: r.size || "",
    price: ((Number(r.price_cents) || 0) / 100).toFixed(2),
    variantId: r.shopify_variant_id || "",
    image: r.img || "",
    images: r.img ? [r.img] : [],
    totalPieces: 0,
    branchCount: 0,
    branches: [] as unknown[],
  }));

  return NextResponse.json({ ok: true, results });
}
