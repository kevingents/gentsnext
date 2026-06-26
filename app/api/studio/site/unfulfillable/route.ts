import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { listUnresolvedUnfulfillable, getFulfillmentMissesByStore } from "@/lib/unfulfillable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/unfulfillable — voor de portal: open (onopgeloste)
 * niet-leverbaar-meldingen die afgehandeld moeten worden (make-whole) + de
 * miss-rate per winkel (betrouwbaarheidssignaal). Auth: admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  try {
    const [items, reliability] = await Promise.all([listUnresolvedUnfulfillable(150), getFulfillmentMissesByStore(90)]);
    return NextResponse.json({ ok: true, items, reliability });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
