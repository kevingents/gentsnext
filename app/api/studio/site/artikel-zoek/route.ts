import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { zoekVarianten } from "@/lib/order-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/artikel-zoek?q=…&limit=20 — artikelzoeker op MAAT-niveau
 * (sku, titel, kleur, barcode) mét prijs en online voorraad, voor de
 * orderbouwer in de portal. Auth: admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  try {
    const rows = await zoekVarianten(sp.get("q") || "", Number(sp.get("limit")) || 20);
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
