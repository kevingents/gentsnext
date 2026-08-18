import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { applyLiveStockRows, clearLiveStockBranches, type LiveStockRowInput } from "@/lib/srs-stock-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/core/stock/live — de storegents 5-min-SFTP-delta-cron schrijft hier de
 * absolute voorraadstanden (schaduw naast de per-filiaal blob-snapshot; fase 1 van
 * "alles naar Neon"). Nog geen lezers — eerst pariteit bewijzen. Auth: STORE_CORE_TOKEN.
 *
 *   upsert          { rows:[{sku,branchId,store?,qty}] }  → { ok, upserted }
 *   clear-branches  { branchIds:[...] }                   → { ok, cleared }
 *     (full-run stuurt clear-branches vóór z'n batches: het delta-XML noemt alleen
 *      gewijzigde barcodes, dus verdwenen rijen moeten expliciet weg)
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: { action?: string; rows?: unknown[]; branchIds?: unknown[] };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }

  try {
    switch (String(b?.action || "")) {
      case "upsert":
        return NextResponse.json(await applyLiveStockRows(Array.isArray(b.rows) ? (b.rows as LiveStockRowInput[]) : []));
      case "clear-branches":
        return NextResponse.json(await clearLiveStockBranches(Array.isArray(b.branchIds) ? b.branchIds.map(String) : []));
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${String(b?.action || "")}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
