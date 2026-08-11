import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/**
 * Productbeeld bij bestelregels — voor het besteloverzicht in het profiel.
 *
 * Twee ingangen, want de twee kanalen bewaren iets anders. Een weborder-regel heeft
 * een product_handle; een kassabon heeft alleen wat er over de scanner ging: een
 * artikelnummer (product_variants.sku) en een EAN (product_variants.barcode). Zonder
 * die tweede ingang blijven winkelaankopen beeldloos, en juist die staan naast de
 * online orders in dezelfde lijst — een halve lijst met foto's ziet er stuk uit.
 */

export type Media = { imageUrl: string; handle: string };

const clean = (v: unknown) => String(v ?? "").trim();

/** Beeld + handle per product-handle (weborder-regels). */
export async function mediaByHandle(handles: string[]): Promise<Map<string, Media>> {
  const uniq = [...new Set(handles.map(clean).filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await getDb().execute<{ handle: string; url: string | null }>(sql`
    select p.handle,
           (select pi.url from product_images pi where pi.product_id = p.id order by pi.position asc limit 1) url
    from products p
    where p.handle in (${sql.join(uniq.map((h) => sql`${h}`), sql`, `)})`);
  return new Map(rows.rows.map((r) => [r.handle, { imageUrl: r.url || "", handle: r.handle }]));
}

/**
 * Beeld + handle per kassa-artikelcode. Zoekt op sku én barcode en geeft één map
 * terug waarin béíde codes naar dezelfde treffer wijzen, zodat de aanroeper niet
 * hoeft te weten welke van de twee raak was.
 */
export async function mediaByArticleCode(codes: string[]): Promise<Map<string, Media>> {
  const uniq = [...new Set(codes.map(clean).filter(Boolean))];
  if (!uniq.length) return new Map();
  const list = sql.join(uniq.map((c) => sql`${c}`), sql`, `);
  const rows = await getDb().execute<{ sku: string | null; barcode: string | null; handle: string; url: string | null }>(sql`
    select v.sku, v.barcode, p.handle,
           (select pi.url from product_images pi where pi.product_id = p.id order by pi.position asc limit 1) url
    from product_variants v
    join products p on p.id = v.product_id
    where (v.sku <> '' and v.sku in (${list})) or (v.barcode <> '' and v.barcode in (${list}))`);
  const out = new Map<string, Media>();
  for (const r of rows.rows) {
    const m: Media = { imageUrl: r.url || "", handle: r.handle || "" };
    // Eerste treffer wint: een tweede variant van hetzelfde artikel (andere maat)
    // levert hetzelfde beeld op, dus overschrijven heeft geen waarde.
    for (const code of [clean(r.sku), clean(r.barcode)]) {
      if (code && !out.has(code)) out.set(code, m);
    }
  }
  return out;
}
