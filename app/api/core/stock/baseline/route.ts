import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { beginBaselineGen, upsertBaselineRows, commitBaselineGen, activeBaselineMeta } from "@/lib/srs-stock-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/core/stock/baseline — de storegents SRS-import pusht hier de volledige
 * voorraadsnapshot naartoe (vervangt de cross-repo blob). Snapshot-swap per gen.
 * Auth: STORE_CORE_TOKEN.
 *
 *   begin   {}                              → { ok, gen }
 *   upsert  { gen, rows:[{sku,branchId,store,qty,tekort,ideaal}] } → { ok, inserted }
 *   commit  { gen, syncedAt? }              → { ok, rowCount } | { ok:false, error }
 *   meta    {}                              → { ok, activeGen, syncedAt, rowCount }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: { action?: string; gen?: string; rows?: unknown[]; syncedAt?: string };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const action = String(b?.action || "");

  try {
    switch (action) {
      case "begin":
        return NextResponse.json({ ok: true, gen: beginBaselineGen() });
      case "upsert":
        return NextResponse.json(
          await upsertBaselineRows(String(b.gen || ""), Array.isArray(b.rows) ? (b.rows as never[]) : []),
        );
      case "commit":
        return NextResponse.json(await commitBaselineGen(String(b.gen || ""), b.syncedAt ?? null));
      case "meta": {
        const m = await activeBaselineMeta();
        return NextResponse.json({ ok: true, ...m, syncedAt: m.syncedAt ? m.syncedAt.toISOString() : null });
      }
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${action}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
