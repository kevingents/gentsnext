import { NextResponse } from "next/server";
import { desc, eq, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { products, productSizeMedia } from "@/db/schema";
import { adminOrToken } from "@/lib/studio-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const THRESHOLDS = ["XL", "XXL", "3XL", "4XL", "5XL"];

/**
 * Productmedia voor de portal: per product een reguliere modelfoto (die de
 * galerij leidt) en een grote-maat-foto die getoond wordt zodra de klant een
 * maat vanaf de drempel kiest.
 *
 * GET  → { ok, items } — alle producten die al media hebben. De Site-studio had
 *        alleen een blind invulformulier: je moest de handle uit je hoofd weten
 *        en kon niet zien wat er al stond. Vandaar dat de portal-kant wél een
 *        overzicht krijgt.
 * POST → body { handle, kind: "model"|"large", url, alt?, threshold?, remove? }
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    const db = getDb();
    const rows = await db
      .select({
        handle: products.handle,
        title: products.title,
        modelImageUrl: products.modelImageUrl,
        modelImageAlt: products.modelImageAlt,
        largeUrl: productSizeMedia.url,
        largeAlt: productSizeMedia.alt,
        threshold: productSizeMedia.threshold,
        updatedAt: productSizeMedia.updatedAt,
      })
      .from(products)
      .leftJoin(productSizeMedia, eq(productSizeMedia.productId, products.id))
      .where(or(ne(products.modelImageUrl, ""), sql`${productSizeMedia.url} is not null`))
      .orderBy(desc(productSizeMedia.updatedAt), products.title)
      .limit(500);

    return NextResponse.json({ ok: true, items: rows, thresholds: THRESHOLDS });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }

  let body: { handle?: string; kind?: string; threshold?: string; url?: string; alt?: string; remove?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const handle = String(body.handle || "").trim();
  if (!handle) return NextResponse.json({ ok: false, error: "Geen product opgegeven." }, { status: 400 });
  const kind = body.kind === "large" ? "large" : "model";

  const db = getDb();
  const [p] = await db.select({ id: products.id }).from(products).where(eq(products.handle, handle)).limit(1);
  if (!p) return NextResponse.json({ ok: false, error: `Product "${handle}" bestaat niet.` }, { status: 404 });

  try {
    if (kind === "model") {
      if (body.remove) {
        await db.update(products).set({ modelImageUrl: "", modelImageAlt: "" }).where(eq(products.id, p.id));
        return NextResponse.json({ ok: true, removed: true });
      }
      const url = String(body.url || "").trim();
      if (!/^https?:\/\//.test(url)) {
        return NextResponse.json({ ok: false, error: "Geen geldige afbeeldings-URL (begin met https://)." }, { status: 400 });
      }
      await db
        .update(products)
        .set({ modelImageUrl: url, modelImageAlt: String(body.alt || "").trim() })
        .where(eq(products.id, p.id));
      return NextResponse.json({ ok: true });
    }

    if (body.remove) {
      await db.delete(productSizeMedia).where(eq(productSizeMedia.productId, p.id));
      return NextResponse.json({ ok: true, removed: true });
    }
    const url = String(body.url || "").trim();
    if (!/^https?:\/\//.test(url)) {
      return NextResponse.json({ ok: false, error: "Geen geldige afbeeldings-URL (begin met https://)." }, { status: 400 });
    }
    // Een drempel buiten de lijst zou de foto onbereikbaar maken: de
    // productpagina vergelijkt de gekozen maat met precies deze waarden.
    const wanted = String(body.threshold || "XXL").trim().toUpperCase();
    const threshold = THRESHOLDS.includes(wanted) ? wanted : "XXL";
    const alt = String(body.alt || "").trim();
    await db
      .insert(productSizeMedia)
      .values({ productId: p.id, threshold, url, alt })
      .onConflictDoUpdate({
        target: productSizeMedia.productId,
        set: { threshold, url, alt, updatedAt: sql`now()` },
      });
    return NextResponse.json({ ok: true, threshold });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
