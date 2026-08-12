import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { saveDraftCore, listDraftsCore, getDraftCore, deleteDraftCore, backfillDraftsCore } from "@/lib/pos-drafts-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/pos-draft — geparkeerde kassa-mandjes in de Neon-core (vervangt
 * de storegents-blob admin/pos-sales-drafts.json). Action-based. Auth: STORE_CORE_TOKEN.
 *
 *   record   { draft }           → { ok, draft }       (upsert op id)
 *   list     { store, limit? }   → { ok, drafts }
 *   get      { id }              → { ok, draft }       (draft = null als niet gevonden)
 *   delete   { id }              → { ok, removed }
 *   backfill { drafts }          → { ok, inserted }    (eenmalige blob-migratie)
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: { action?: string; draft?: Record<string, unknown>; drafts?: Record<string, unknown>[]; store?: string; limit?: number; id?: string };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const action = String(b?.action || "");

  try {
    switch (action) {
      case "record":
        return NextResponse.json(await saveDraftCore(b.draft || {}));
      case "list":
        return NextResponse.json({ ok: true, drafts: await listDraftsCore(String(b.store || "").trim(), b.limit) });
      case "get":
        return NextResponse.json({ ok: true, draft: await getDraftCore(String(b.id || "")) });
      case "delete":
        return NextResponse.json(await deleteDraftCore(String(b.id || "")));
      case "backfill":
        return NextResponse.json(await backfillDraftsCore(b.drafts || []));
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${action}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
