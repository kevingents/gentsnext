import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { adminOrToken } from "@/lib/studio-token";
import { getVisualLearnings, REJECT_CATEGORIES } from "@/lib/visual-learnings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/lifestyle/gallery?q&page — alle sfeerbeelden (lifestyle) van de
 * nieuwe site, plat per slot, + de afkeur-categorieën en de huidige learnings.
 * Voor de portal "Lerende sfeerbeeld-studio". Auth: admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") || "").trim().toLowerCase();
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(sp.get("pageSize")) || 40));

  try {
    const db = getDb();
    const hasAny = sql`(p.lifestyle_image_url<>'' or p.lifestyle_image_url2<>'' or p.lifestyle_image_url3<>'')`;
    const qCond = q ? sql`and (lower(p.title) like ${`%${q}%`} or lower(p.handle) like ${`%${q}%`})` : sql``;
    const [{ n }] = (await db.execute<{ n: string }>(sql`select count(*) n from products p where ${hasAny} ${qCond}`)).rows;
    const rows = await db.execute<{ handle: string; title: string; hg: string; l1: string; l2: string; l3: string }>(sql`
      select p.handle, p.title, p.attributes->>'hoofdgroep_omschrijving' hg,
        p.lifestyle_image_url l1, p.lifestyle_image_url2 l2, p.lifestyle_image_url3 l3
      from products p where ${hasAny} ${qCond}
      order by p.updated_at desc limit ${pageSize} offset ${(page - 1) * pageSize}`);

    const items = rows.rows.map((r) => ({
      handle: r.handle,
      title: r.title,
      hoofdgroep: r.hg || "",
      slots: [
        ...(r.l1 ? [{ slot: 1, url: r.l1 }] : []),
        ...(r.l2 ? [{ slot: 2, url: r.l2 }] : []),
        ...(r.l3 ? [{ slot: 3, url: r.l3 }] : []),
      ],
    }));

    const learnings = await getVisualLearnings();
    return NextResponse.json({
      ok: true,
      total: Number(n) || 0,
      page,
      pageSize,
      items,
      categories: Object.entries(REJECT_CATEGORIES).map(([key, v]) => ({ key, label: v.label })),
      learnings: { count: learnings.learnings.length, recent: learnings.learnings.slice(0, 30), updatedAt: learnings.updatedAt },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
