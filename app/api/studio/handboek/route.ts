import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { bouwHandboek } from "@/lib/handboek";
import { HANDBOEK_CSS } from "@/lib/handboek-stijl";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/handboek — het platformhandboek als data, voor de portal.
 *
 * De portal kan twee dingen doen: linken naar /handboek (het volledige scherm,
 * inclusief zoeken), of deze inhoud zelf tonen in zijn eigen schil. Voor dat
 * tweede is dit endpoint er — inclusief de stylesheet, zodat de opmaak niet in
 * twee repo's onderhouden hoeft te worden.
 *
 * Query:
 *   ?deel=<id>   alleen dat deel (bv. "keten") — scheelt de portal een grote payload
 *   ?css=0       de stylesheet weglaten
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const deelId = (url.searchParams.get("deel") || "").trim();
    const metCss = url.searchParams.get("css") !== "0";

    const handboek = await bouwHandboek();
    const delen = deelId ? handboek.delen.filter((d) => d.id === deelId) : handboek.delen;
    if (deelId && !delen.length) {
      return NextResponse.json({ ok: false, error: `Onbekend deel: ${deelId}.` }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      stand: handboek.stand,
      delen,
      ...(metCss ? { css: HANDBOEK_CSS } : {}),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
