import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { markDisplay, unmarkDisplay, listDisplay, listAllDisplay, applySale, type DisplayLine } from "@/lib/display";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/display — paspop/etalage-markering (niet-blokkerend). Auth: STORE_CORE_TOKEN.
 *   mark     { location, line:{sku/barcode,title,...}, qty?, note?, createdBy? }
 *   unmark   { location, stockKey, qty? }   (qty weglaten = alles weg)
 *   list     { location }                   (per winkel)
 *   overview { limit? }                     (alle winkels — supply-chain)
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: { action?: string; location?: string; line?: DisplayLine; lines?: { sku?: string; barcode?: string; stockKey?: string; qty?: number }[]; stockKey?: string; qty?: number; note?: string; createdBy?: string; limit?: number };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const action = String(b?.action || "");

  try {
    switch (action) {
      case "mark":
        if (!b.location) return NextResponse.json({ ok: false, error: "location vereist." }, { status: 400 });
        return NextResponse.json(await markDisplay({ location: b.location, line: b.line || {}, qty: b.qty, note: b.note, createdBy: b.createdBy }));
      case "unmark":
        if (!b.location || !b.stockKey) return NextResponse.json({ ok: false, error: "location + stockKey vereist." }, { status: 400 });
        return NextResponse.json(await unmarkDisplay({ location: b.location, stockKey: b.stockKey, qty: b.qty }));
      case "list":
        if (!b.location) return NextResponse.json({ ok: false, error: "location vereist." }, { status: 400 });
        return NextResponse.json({ ok: true, items: await listDisplay(b.location) });
      case "overview":
        return NextResponse.json({ ok: true, items: await listAllDisplay(b.limit) });
      case "sold":
        // Kassa-verkoop → verkochte stuks automatisch van de paspop halen.
        if (!b.location) return NextResponse.json({ ok: false, error: "location vereist." }, { status: 400 });
        return NextResponse.json({ ok: true, ...(await applySale(b.location, b.lines || [])) });
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${action}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
