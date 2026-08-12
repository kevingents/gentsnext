import { NextResponse } from "next/server";
import { adminOrToken, rangeFromQuery } from "@/lib/studio-token";
import { bonusReport } from "@/lib/loyalty-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// De effect-vraag doet per order een lookup in het grootboek; op een paar
// tienduizend orders duurt dat langer dan de standaard-limiet van 15 seconden.
export const maxDuration = 60;

/**
 * GET /api/studio/site/punten?from&to — meet de spaarpunten-bonussen.
 *
 * Adoptie (wie haalt ze, wat kost het), trechter (gezien → geklikt → gehaald)
 * en effect (retour% en orderwaarde van klanten mét versus zónder de bonus).
 * Het antwoord draagt zijn eigen kanttekening mee: `kanttekening` hoort in de
 * portal bij de cijfers te staan, want dit is een waarneming en geen bewijs.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    const rapport = await bonusReport(rangeFromQuery(new URL(req.url), 90));
    return NextResponse.json({ ok: true, ...rapport });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
