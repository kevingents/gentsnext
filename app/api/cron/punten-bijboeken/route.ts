import { NextResponse } from "next/server";
import { backfillOrderLoyalty } from "@/lib/loyalty-backfill";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Zelfherstel voor het spaarpunten-grootboek: boekt elk uur een batch betaalde
 * orders bij die om wat voor reden dan ook geen puntenregel kregen.
 *
 * Punten worden normaal op het betaal-choke-point geboekt (applyPaymentStatus).
 * Deze cron is het vangnet daaronder — voor een webhook die stukliep, een order die
 * via een importpad binnenkwam, of een account dat pas ná de order gekoppeld werd.
 * Zonder zo'n vangnet valt het grootboek stil zonder dat iemand het merkt, want een
 * ontbrekende puntenregel geeft geen fout: de klant ziet alleen een saldo van 0.
 *
 * Idempotent (unieke index op ref_type+ref_id) — dubbel draaien kan geen kwaad.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const url = new URL(req.url);
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    /* Alleen recente orders — het terugkijkvenster staat in de instellingen (30 dagen
       standaard). Zonder die grens zou het uitrollen van deze cron stilzwijgend de
       hele Shopify-historie uitkeren; dat is een geld-besluit, geen deploy-bijwerking.
       De volledige inhaalslag draai je bewust met `npm run backfill:punten -- --doen`.
       Batch klein genoeg voor de 60s-limiet; de rest volgt het uur erop. */
    const lookbackDays = (await getSettings()).loyaltyConfig?.backfillLookbackDays ?? 30;
    const res = await backfillOrderLoyalty({ limit: 400, lookbackDays });
    if (res.geboekt || res.correcties) {
      console.info(`[cron/punten-bijboeken] ${res.geboekt} orders · ${res.punten} punten · ${res.correcties} retour-correcties · ${Math.max(0, res.openstaand - res.geboekt)} te gaan`);
    }
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    console.error("[cron/punten-bijboeken]", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
