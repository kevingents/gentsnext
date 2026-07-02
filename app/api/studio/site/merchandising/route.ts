import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { adminOrToken } from "@/lib/studio-token";
import { getDb } from "@/db";
import { CATEGORIES } from "@/lib/categories";
import { listCollections } from "@/lib/catalog";
import {
  getAllMerchandisingPins,
  setMerchandisingPins,
  pinKey,
  type PinContextKind,
} from "@/lib/merchandising";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Portal-"Nieuwe site" → Merchandising. Beheert de merchandising-pins: per
 * PLP-context (categorie/collectie) een geordende lijst producten die bovenaan
 * de "Aanbevolen"-sort komen. Config in de settings-store (niet hardcoded).
 *
 * GET  → { ok, categories, collections, pins } — pins = key → [{handle,title,image}]
 *        (in de gepinde volgorde), voor het overzicht + de editor.
 * POST → body { kind, slug, handles[] } → zet die context; geeft de context terug.
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */

type PinnedProduct = { handle: string; title: string; image: string; inStock: boolean };

/** Resolvet handles → productkaarten, in de opgegeven volgorde (onbekende handles vallen weg). */
async function resolvePinned(handles: string[]): Promise<PinnedProduct[]> {
  const list = [...new Set(handles.map((h) => String(h || "").trim()).filter(Boolean))];
  if (!list.length) return [];
  const db = getDb();
  const rows = await db.execute<{ handle: string; title: string; image: string; in_stock: boolean }>(sql`
    select p.handle, p.title,
      coalesce(nullif(split_part(p.model_image_url,'?',1),''),
               (select split_part(pi.url,'?',1) from product_images pi where pi.product_id = p.id order by pi.position asc limit 1),
               '') image,
      p.in_stock
    from products p
    where p.handle in (${sql.join(list.map((h) => sql`${h}`), sql`, `)})`);
  const byHandle = new Map(rows.rows.map((r) => [r.handle, r]));
  return list
    .map((h) => byHandle.get(h))
    .filter(Boolean)
    .map((r) => ({ handle: r!.handle, title: r!.title, image: r!.image, inStock: r!.in_stock }));
}

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    const [allPins, collections] = await Promise.all([getAllMerchandisingPins(), listCollections()]);
    // Resolve elke pin-lijst naar productkaarten (in volgorde), parallel.
    const keys = Object.keys(allPins);
    const resolved = await Promise.all(keys.map((k) => resolvePinned(allPins[k] || [])));
    const pins: Record<string, PinnedProduct[]> = {};
    keys.forEach((k, i) => (pins[k] = resolved[i]));
    return NextResponse.json({
      ok: true,
      categories: CATEGORIES.map((c) => ({ slug: c.slug, label: c.label })),
      collections: collections.map((c) => ({ handle: c.handle, title: c.title })),
      pins,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { kind?: string; slug?: string; handles?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const kind = body.kind === "collection" ? "collection" : body.kind === "categorie" ? "categorie" : null;
  const slug = String(body.slug || "").trim();
  if (!kind || !slug) {
    return NextResponse.json({ ok: false, error: "kind (categorie|collection) en slug vereist." }, { status: 400 });
  }
  const handles = Array.isArray(body.handles) ? body.handles.map((h) => String(h || "").trim()).filter(Boolean) : [];
  try {
    const saved = await setMerchandisingPins(kind as PinContextKind, slug, handles);
    const pinnedProducts = await resolvePinned(saved);
    return NextResponse.json({ ok: true, key: pinKey(kind as PinContextKind, slug), handles: saved, pinnedProducts });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
