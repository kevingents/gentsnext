import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { cronSecretOk } from "@/lib/cron-auth";
import { rolHeatmapOp } from "@/lib/heatmap";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Nachtelijke heatmap-rollup (zie vercel.json). Vat de laatste drie hele dagen
 * samen in dagtotalen en ruimt daarna het ruwe materiaal op dat ouder is dan de
 * ingestelde bewaartermijn (Instellingen → heatmap.bewaardagen).
 *
 * Die opruiming is het punt: de dagtotalen bevatten geen sessie-id meer, dus na
 * deze stap is er van een bezoek niets individueels meer terug te vinden terwijl
 * de grafieken gewoon blijven werken.
 *
 * Draait ná middernacht NL-tijd; de rollup rekent zelf in Europe/Amsterdam.
 */
export async function GET(req: Request) {
  const viaCron = cronSecretOk(req);
  const customer = viaCron ? null : await getSessionCustomer();
  if (!viaCron && !customer?.isAdmin) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const resultaat = await rolHeatmapOp();
    return NextResponse.json({ ok: true, ...resultaat });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "cron-fout" }, { status: 500 });
  }
}
