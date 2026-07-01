import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/catalog/search — SNELLE fuzzy tekstzoek over de catalogus voor het
 * GETYPTE zoeken in de kassa (tegenhanger van /catalog/lookup voor de barcode-scan).
 *
 * KALE, directe pg_trgm-query (geen searchProducts-overhead zoals locale/settings/kaart-
 * opbouw): één query die per variant matcht op titel (word_similarity + ilike), sku,
 * barcode en kleur, gerangschikt op score. Bewust GEEN in_stock/zichtbaarheids-filter:
 * aan de kassa moet je élk actief artikel kunnen vinden (ook het laatste stuk, of iets
 * dat de — soms verouderde — catalogus-voorraadvlag zou verbergen). Voorraad volgt async
 * via /api/store/article-stock. Auth: STORE_CORE_TOKEN of admin/STUDIO_API_TOKEN.
 *
 * Body: { q, limit? } → { ok, results:[ ... article-search entry ... ] }
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
  if (q.length < 2) return NextResponse.json({ ok: true, results: [] });

  const qLower = q.toLowerCase();
  const like = `%${qLower}%`;
  const rowCap = Math.min(limit * 6, 120); // variant-rijen; frontend groepeert per artikel+kleur

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
      coalesce((select pi.url from product_images pi where pi.product_id = v.product_id order by pi.position asc limit 1), nullif(v.image_url, '')) img,
      greatest(
        word_similarity(${qLower}, lower(p.title)),
        case
          when lower(coalesce(v.sku, '')) = ${qLower} or lower(coalesce(v.barcode, '')) = ${qLower} then 1.0
          when lower(coalesce(v.sku, '')) like ${like} or lower(coalesce(v.barcode, '')) like ${like} then 0.95
          when lower(p.title) like ${like} then 0.9
          when lower(coalesce(v.color, '')) like ${like} then 0.5
          else 0
        end
      ) as score
    from product_variants v
    join products p on p.id = v.product_id
    where p.status = 'active' and (
      word_similarity(${qLower}, lower(p.title)) > 0.3
      or lower(p.title) like ${like}
      or lower(coalesce(v.sku, '')) like ${like}
      or lower(coalesce(v.barcode, '')) like ${like}
      or lower(coalesce(v.color, '')) like ${like}
    )
    order by score desc, p.title asc, v.size asc
    limit ${rowCap}`);

  const results = rows.rows.map((r) => ({
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
