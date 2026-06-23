import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { webReservedForLocation } from "@/lib/store-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/stock/web-reserved — web-reserveringen (lopende web-orders) per
 * stockKey voor één locatie. De kassa trekt dit van z'n eigen voorraadweergave af
 * zodat de kassier ziet wat er online gereserveerd is. Auth: STORE_CORE_TOKEN of
 * admin/STUDIO_API_TOKEN.
 *
 * Body: { location }  → { ok, reserved: { <stockKey>: aantal } }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { location?: string };
  try {
    body = (await req.json()) as { location?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const location = String(body?.location || "").trim();
  if (!location) {
    return NextResponse.json({ ok: false, error: "location vereist." }, { status: 400 });
  }
  try {
    const m = await webReservedForLocation(location);
    return NextResponse.json({ ok: true, reserved: Object.fromEntries(m) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
