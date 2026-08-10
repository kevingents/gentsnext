import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/catalog/packshots — uitslag van de beeld-classificatie opslaan.
 *
 * De classificatie draait in storegents (lib/beeldbank-vision.js): die beoordeelt per
 * product elke foto als packshot of model-/sfeerbeeld. Hier landt die uitslag, zodat
 * de kassa-queries (catalog/search en catalog/lookup) de packshot kunnen kiezen zonder
 * eerst een blob in storegents te lezen.
 *
 * Body: { photos: [{ url, packshot: boolean }] }
 *   → { ok, updated }
 *
 * Op URL gematcht, niet op product-id: de classificatie kent de Shopify-URL van elke
 * foto en dat is precies wat in product_images.url staat. Scheelt een vertaalslag
 * tussen Shopify-product-id's en de uuid's hier, die bij Neon-native producten
 * sowieso niet bestaat. De querystring gaat er aan beide kanten af, zodat een
 * ?width=…-variant nog steeds dezelfde foto is.
 *
 * Idempotent: dezelfde uitslag nogmaals sturen verandert niets. Foto's die niet in de
 * body zitten blijven ongemoeid — een batch beoordeelt maar een deel van de catalogus.
 *
 * Auth: STORE_CORE_TOKEN of admin/STUDIO_API_TOKEN.
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }

  let body: { photos?: { url?: string; packshot?: boolean }[] };
  try {
    body = (await req.json()) as { photos?: { url?: string; packshot?: boolean }[] };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }

  const seen = new Set<string>();
  const urls: string[] = [];
  const flags: boolean[] = [];
  for (const p of Array.isArray(body?.photos) ? body.photos : []) {
    const url = String(p?.url || "").trim();
    if (!url) continue;
    /* Dezelfde foto twee keer in één body zou de update dubbelzinnig maken
       (Postgres kiest dan willekeurig één rij uit de bron). Eerste wint. */
    const key = url.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
    flags.push(p?.packshot === true);
  }

  if (!urls.length) return NextResponse.json({ ok: true, updated: 0 });
  /* Ruime bovengrens: een classificatie-batch is ~20 producten × max 8 foto's. */
  if (urls.length > 2000) {
    return NextResponse.json({ ok: false, error: "Te veel foto's in één keer (max 2000)." }, { status: 400 });
  }

  const res = await getDb().execute(sql`
    update product_images pi
       set is_packshot = x.pack
      from (select unnest(${urls}::text[]) url, unnest(${flags}::boolean[]) pack) x
     where split_part(pi.url, '?', 1) = split_part(x.url, '?', 1)
       and pi.is_packshot is distinct from x.pack`);

  return NextResponse.json({ ok: true, updated: res.rowCount ?? 0 });
}
