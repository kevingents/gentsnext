import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { products, productSizeMedia } from "@/db/schema";
import { getSessionCustomer } from "@/lib/account";

export const dynamic = "force-dynamic";

/** Admin: grote-maat-foto per product instellen (of verwijderen). */
export async function POST(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer?.isAdmin) return NextResponse.json({ ok: false, error: "geen beheerrechten" }, { status: 403 });

  let body: { handle?: string; threshold?: string; url?: string; alt?: string; remove?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }
  const handle = String(body.handle || "").trim();
  if (!handle) return NextResponse.json({ ok: false, error: "geen product-handle" }, { status: 400 });

  const db = getDb();
  const [p] = await db.select({ id: products.id }).from(products).where(eq(products.handle, handle)).limit(1);
  if (!p) return NextResponse.json({ ok: false, error: "product niet gevonden" }, { status: 404 });

  if (body.remove) {
    await db.delete(productSizeMedia).where(eq(productSizeMedia.productId, p.id));
    return NextResponse.json({ ok: true, removed: true });
  }

  const url = String(body.url || "").trim();
  if (!/^https?:\/\//.test(url)) return NextResponse.json({ ok: false, error: "ongeldige afbeeldings-URL" }, { status: 400 });
  const threshold = String(body.threshold || "XXL").trim();
  const alt = String(body.alt || "").trim();

  await db
    .insert(productSizeMedia)
    .values({ productId: p.id, threshold, url, alt })
    .onConflictDoUpdate({ target: productSizeMedia.productId, set: { threshold, url, alt, updatedAt: sql`now()` } });

  return NextResponse.json({ ok: true });
}
