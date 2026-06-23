import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { getSuitPieceHandles } from "@/lib/suit-pairing";
import { saveLook, type StoredLook } from "@/lib/looks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/studio/site/looks/generate — stelt automatisch een CONCEPT-look samen
 * uit de eigen catalogus: een in-stock colbert/pak met modelfoto + de bijpassende
 * pantalon/gilet (mix & match suit-pairing) + wit overhemd + passende schoen. Komt
 * als 'draft' in de looks-store → de beheerder keurt 'm goed. Auth: admin/STUDIO_API_TOKEN.
 *
 * Body: { occasion?, theme?, offset? }  (offset roteert het basisproduct voor variatie)
 */
const SHOE_BY_OCCASION: Record<string, string> = {
  Gala: "lakschoen",
  Uitvaart: "veterschoen-glad-zwart",
};
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { occasion?: string; theme?: string; offset?: number };
  try {
    body = (await req.json()) as { occasion?: string; theme?: string; offset?: number };
  } catch {
    body = {};
  }
  const occasion = String(body.occasion || "Zakelijk").trim();
  const theme = String(body.theme || "").trim();
  const offset = Math.max(0, Math.min(100, Math.round(Number(body.offset) || 0)));

  try {
    const db = getDb();
    const rows = await db.execute<{ handle: string; title: string; model_image_url: string; hoofdgroep: string }>(sql`
      select handle, title, model_image_url, attributes->>'hoofdgroep_omschrijving' as hoofdgroep
      from products
      where status='active' and has_image=true and in_stock=true and is_group_primary=true
        and model_image_url <> ''
        and attributes->>'hoofdgroep_omschrijving' in ('Colberts','Pakken')
      order by stock_qty desc
      limit 1 offset ${offset}
    `);
    const p = rows.rows[0];
    if (!p) return NextResponse.json({ ok: false, error: "Geen geschikt product gevonden." }, { status: 404 });

    const isPak = (p.hoofdgroep || "").toLowerCase().includes("pak");
    const pieces = await getSuitPieceHandles(p.handle).catch(() => null);

    const hotspots: { x: number; y: number; handle: string; label?: string }[] = [
      { x: 50, y: 22, handle: "overhemd-nos-wit", label: "Overhemd" },
      { x: 50, y: isPak ? 40 : 34, handle: p.handle, label: isPak ? "Pak" : "Colbert" },
    ];
    if (pieces?.gilet) hotspots.push({ x: 50, y: 48, handle: pieces.gilet, label: "Gilet" });
    if (pieces?.broek) hotspots.push({ x: 50, y: 72, handle: pieces.broek, label: "Pantalon" });
    hotspots.push({ x: 50, y: 93, handle: SHOE_BY_OCCASION[occasion] || "leder-classic-cognac", label: "Schoenen" });

    const look: StoredLook = {
      slug: `ai-${slugify(occasion)}-${slugify(p.handle).slice(0, 18)}`,
      title: `${occasion} look`,
      subtitle: `${occasion}${theme ? ` · ${theme}` : ""} — automatisch samengesteld, klaar om te beoordelen.`,
      occasion,
      theme: theme || undefined,
      image: p.model_image_url,
      hotspots,
      story: `Een complete ${occasion.toLowerCase()}-look rond ${p.title}. Mix & match: het colbert, de pantalon en het gilet zijn los te combineren in dezelfde stof.`,
      status: "draft",
    };
    await saveLook(look);
    return NextResponse.json({ ok: true, look });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
