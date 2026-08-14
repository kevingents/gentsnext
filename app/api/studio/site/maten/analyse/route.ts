import { NextResponse } from "next/server";
import { adminOrToken, rangeFromQuery } from "@/lib/studio-token";
import { adviesKwaliteit, verkoopEnRetourenPerMaat } from "@/lib/maat-analyse";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Maat-analyse voor de portal (Site → Maten).
 *
 * ?van & ?tot (ISO) — standaard de laatste 180 dagen. Een maand is te kort: een
 * enkele maat binnen één hoofdgroep haalt dan geen aantallen waar je iets over
 * kunt zeggen, en dan staat er een retourpercentage van 100% bij n=1.
 *
 * ?hoofdgroep — één categorie eruit.
 * ?minimum — onder dit aantal verkocht laten we een maat weg (standaard 5).
 * ?deel=maten|advies — alleen die helft berekenen. De verkoopkant is een
 *   aggregatie over alle orderregels van een half jaar; die hoeft niet mee te
 *   draaien als je alleen het advieskwaliteit-scherm opent.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const { from, to } = rangeFromQuery(url, 180);
    const hoofdgroep = (url.searchParams.get("hoofdgroep") || "").trim();
    const minimum = Number(url.searchParams.get("minimum") || 5);
    const deel = (url.searchParams.get("deel") || "").trim();
    const wilMaten = deel !== "advies";
    const wilAdvies = deel !== "maten";

    // De retourtermijn staat in de tool (Instellingen → Retouren); die bepaalt
    // vanaf wanneer een periode "af" is en dus eerlijk te vergelijken.
    const termijn = await getSettings()
      .then((s) => s.returnConfig?.windowDays)
      .catch(() => undefined);

    /* De twee helften los afhandelen. Ze hebben niets met elkaar te maken, en
       één kapotte helft mag de andere niet meesleuren: zolang drizzle/0059 nog
       niet op de database staat bestaat maatadvies_log niet, en dan hoort het
       verkoop/retouren-overzicht het gewoon te doen. */
    const [matenUitkomst, adviesUitkomst] = await Promise.allSettled([
      wilMaten
        ? verkoopEnRetourenPerMaat({
            van: from,
            tot: to,
            hoofdgroep: hoofdgroep || undefined,
            minimumVerkocht: Number.isFinite(minimum) ? minimum : 5,
            retourtermijnDagen: termijn,
          })
        : Promise.resolve(null),
      wilAdvies ? adviesKwaliteit({ van: from, tot: to }) : Promise.resolve(null),
    ]);

    if (matenUitkomst.status === "rejected") {
      console.error("[studio/maten/analyse] verkoop/retouren mislukt:", matenUitkomst.reason);
    }
    if (adviesUitkomst.status === "rejected") {
      console.error("[studio/maten/analyse] advieskwaliteit mislukt:", adviesUitkomst.reason);
    }
    // Allebei stuk = er is echt iets mis; dat is wél een 500.
    if (matenUitkomst.status === "rejected" && adviesUitkomst.status === "rejected") {
      return NextResponse.json({ ok: false, error: "Kon de analyse niet maken." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      maten: matenUitkomst.status === "fulfilled" ? matenUitkomst.value : null,
      advies: adviesUitkomst.status === "fulfilled" ? adviesUitkomst.value : null,
      /* Welke helft het niet deed, zodat de portal "dit deel kan nog niet"
         kan zeggen in plaats van een leeg blok te tonen. */
      mislukt: [
        matenUitkomst.status === "rejected" ? "maten" : null,
        adviesUitkomst.status === "rejected" ? "advies" : null,
      ].filter(Boolean),
    });
  } catch (e) {
    console.error("[studio/maten/analyse] fout:", e);
    return NextResponse.json({ ok: false, error: "Kon de analyse niet maken." }, { status: 500 });
  }
}
