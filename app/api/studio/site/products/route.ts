import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { adminOrToken } from "@/lib/studio-token";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/products?search&status&page&pageSize
 * Gepagineerde catalogus-/voorraadlijst van de nieuwe site voor het portal-
 * "Nieuwe site"-CMS. Per product: variant-aantal + min/max prijs (centen)
 * geaggregeerd uit product_variants. `search` matcht title/handle (ilike) of
 * variant.sku. Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const search = (sp.get("search") || "").trim();
  const status = (sp.get("status") || "").trim();
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(sp.get("pageSize")) || 30));

  const conds = [sql`1=1`];
  if (search) {
    const q = `%${search.toLowerCase()}%`;
    conds.push(sql`(
      lower(p.title) like ${q}
      or lower(p.handle) like ${q}
      or exists (select 1 from product_variants v2 where v2.product_id = p.id and lower(v2.sku) like ${q})
    )`);
  }
  if (status) conds.push(sql`p.status = ${status}`);
  const where = sql.join(conds, sql` and `);

  try {
    const db = getDb();
    const [{ n }] = (
      await db.execute<{ n: string }>(sql`select count(*) n from products p where ${where}`)
    ).rows;
    const rows = await db.execute<{
      handle: string; title: string; vendor: string; product_type: string; status: string;
      in_stock: boolean; stock_qty: number; has_image: boolean; created_at: string; image: string;
      variant_count: string; min_price_cents: string | null; max_price_cents: string | null;
    }>(sql`
      select p.handle, p.title, p.vendor, p.product_type, p.status,
             p.in_stock, p.stock_qty, p.has_image,
             split_part(p.model_image_url,'?',1) image,
             to_char(p.created_at,'YYYY-MM-DD') created_at,
             count(v.id) variant_count, min(v.price_cents) min_price_cents, max(v.price_cents) max_price_cents
      from products p
      left join product_variants v on v.product_id = p.id
      where ${where}
      group by p.id, p.handle, p.title, p.vendor, p.product_type, p.status, p.in_stock, p.stock_qty, p.has_image, p.model_image_url, p.created_at
      order by p.created_at desc
      limit ${pageSize} offset ${(page - 1) * pageSize}`);

    return NextResponse.json({
      ok: true,
      total: Number(n) || 0,
      page,
      pageSize,
      rows: rows.rows.map((x) => ({
        handle: x.handle,
        title: x.title,
        vendor: x.vendor,
        productType: x.product_type,
        status: x.status,
        inStock: !!x.in_stock,
        stockQty: Number(x.stock_qty) || 0,
        variantCount: Number(x.variant_count) || 0,
        minPriceCents: x.min_price_cents == null ? 0 : Number(x.min_price_cents) || 0,
        maxPriceCents: x.max_price_cents == null ? 0 : Number(x.max_price_cents) || 0,
        hasImage: !!x.has_image,
        image: x.image || "",
        createdAt: x.created_at,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
