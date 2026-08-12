import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { cronSecretOk } from "@/lib/cron-auth";
import { herbouwProfielen, klantenMetActiviteitSinds } from "@/lib/customer-360";
import { bouwAlleDoelgroepen } from "@/lib/audiences";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Nachtelijke herbouw van de klantprofielen en de doelgroepen.
 *
 * Volgorde is dwingend: eerst de PROFIELEN, dan de DOELGROEPEN. Een doelgroep
 * is een filter over de profieltabel — bouw je hem op de versie van gisteren,
 * dan zit een klant die vanochtend kocht vanavond nog steeds in
 * "winkelwagen laten staan". Dat is precies het soort fout waar een klant een
 * mailtje van krijgt dat nergens op slaat.
 *
 * Twee standen:
 *   volledig (?volledig=1 of 's nachts) — alle klanten. Nodig omdat RFM een
 *     rangschikking is: als niemand anders herrekend wordt, verschuift een
 *     kwintiel nooit en verstart de segmentatie.
 *   snel (standaard overdag) — alleen klanten die sinds de vorige run iets
 *     deden. Veel goedkoper, maar RFM draait toch over de hele tabel, dus de
 *     scores blijven onderling vergelijkbaar.
 */
export async function GET(req: Request) {
  if (!cronSecretOk(req)) {
    const customer = await getSessionCustomer().catch(() => null);
    if (!customer?.isAdmin) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const volledig = url.searchParams.get("volledig") === "1" || new Date().getUTCHours() < 6;
  const urenTerug = Math.min(72, Math.max(1, Number(url.searchParams.get("uren")) || 26));

  try {
    let doel: string[] | undefined;
    if (!volledig) {
      const sinds = new Date(Date.now() - urenTerug * 3600_000);
      doel = await klantenMetActiviteitSinds(sinds);
      // Niemand actief? Dan is er niets te herbouwen — maar de doelgroepen wél,
      // want die kennen ook tijd-afhankelijke regels ("langer dan 90 dagen
      // geleden"): een klant kan er invallen zonder dat hij iets deed.
      if (!doel.length) {
        const groepen = await bouwAlleDoelgroepen();
        return NextResponse.json({ ok: true, modus: "snel", profielen: 0, doelgroepen: groepen });
      }
    }

    const profielen = await herbouwProfielen(doel);
    const doelgroepen = await bouwAlleDoelgroepen();

    return NextResponse.json({
      ok: true,
      modus: volledig ? "volledig" : "snel",
      profielen: profielen.profielen,
      rfm: profielen.rfm,
      ms: profielen.ms,
      doelgroepen,
    });
  } catch (e) {
    console.error("[cron/klantprofielen]", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
