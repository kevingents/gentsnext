import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { adminOrToken } from "@/lib/studio-token";
import { getDb } from "@/db";
import { getModelLearnings, MODEL_REJECT_CATEGORIES } from "@/lib/model-learnings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Modellen-studio gallery: alle producten met een AI-modelfoto, voor de portal
 * "Modellen-studio" (goed/afkeuren → AI leert de model-smaak). Auth: admin OF token.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") || "").trim().toLowerCase();
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(120, Math.max(12, Number(sp.get("pageSize")) || 60));

  try {
    const db = getDb();
    const where = q
      ? sql`coalesce(model_image_url,'') <> '' and (lower(handle) like ${"%" + q + "%"} or lower(title) like ${"%" + q + "%"})`
      : sql`coalesce(model_image_url,'') <> ''`;
    const [{ n }] = (await db.execute<{ n: string }>(sql`select count(*) n from products where ${where}`)).rows;
    const rows = await db.execute<{ handle: string; title: string; hg: string; url: string }>(sql`
      select handle, title, attributes->>'hoofdgroep_omschrijving' hg, model_image_url url
      from products where ${where}
      order by stock_qty desc limit ${pageSize} offset ${(page - 1) * pageSize}`);

    const store = await getModelLearnings();
    return NextResponse.json({
      ok: true,
      total: Number(n) || 0,
      page,
      pageSize,
      items: rows.rows.map((r) => ({ handle: r.handle, title: r.title, hoofdgroep: r.hg || "", url: r.url })),
      categories: Object.entries(MODEL_REJECT_CATEGORIES).map(([key, v]) => ({ key, label: v.label })),
      learnings: {
        count: store.learnings.length,
        updatedAt: store.updatedAt,
        recent: store.learnings.slice(0, 24).map((l) => ({ category: l.category, reason: l.reason, kind: l.kind || "negative", handle: l.handle, at: l.at })),
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
