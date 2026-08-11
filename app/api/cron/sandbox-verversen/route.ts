import { NextResponse } from "next/server";
import { isSandbox } from "@/lib/sandbox/env.js";
import { leesVerversStand, legVerversingVast } from "@/lib/sandbox/state.js";
import { ververs } from "@/lib/sandbox-verversen";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * /api/cron/sandbox-verversen — zet de sandbox-database 's nachts terug op een
 * verse, geanonimiseerde kopie van productie.
 *
 * WAAROM DIT IN PRODUCTIE NIETS DOET
 * `vercel.json` hoort bij de repo, niet bij één Vercel-project. Deze cron wordt
 * dus ook geregistreerd op het PRODUCTIE-project van gents.nl — daar kunnen we
 * niets aan doen. Vandaar dat de eerste echte regel van deze handler een
 * sandbox-controle is: buiten de sandbox stopt hij meteen, met een 200 zodat
 * Vercel het niet als storing meldt maar met `overgeslagen: true` zodat je in
 * het log ziet dát hij niets deed.
 *
 * De verversing zelf heeft nog drie eigen weigergronden bovenop deze (zie
 * lib/sandbox-verversen.ts). Overschrijven van de verkeerde branch kan dus niet
 * per ongeluk gebeuren.
 */
function secretOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!secretOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (!isSandbox()) {
    return NextResponse.json({
      ok: true,
      overgeslagen: true,
      reden: "Deze omgeving staat niet in sandbox-stand; er is niets te verversen.",
    });
  }

  const params = new URL(req.url).searchParams;

  /* Twee handstanden voor ingebruikname en herstel. Beide slaan de pauzeknop
     over: je roept ze bewust zelf aan, dus een pauze die voor de nachtcron
     bedoeld is hoort je niet tegen te houden.
       ?droogloop=1        controleer de instellingen, wijzig niets
       ?anonimiseer=1      alleen anonimiseren, geen verse kopie ophalen */
  if (params.get("droogloop") === "1" || params.get("anonimiseer") === "1") {
    const uitslag = await ververs({
      droogloop: params.get("droogloop") === "1",
      slaHerstelOver: params.get("anonimiseer") === "1",
    });
    return NextResponse.json(uitslag, { status: uitslag.ok ? 200 : 500 });
  }

  /* Pauzeknop uit de portal: iemand draait een test over meerdere dagen. De
     pauze verloopt vanzelf na 24 uur, dus een vergeten knop laat de sandbox
     niet maandenlang verouderen. */
  const stand = await leesVerversStand();
  if (stand.gepauzeerd) {
    const uitslag = {
      ok: true,
      overgeslagen: true,
      reden: `Verversen staat op pauze tot ${stand.pauzeTot}${stand.pauzeDoor ? ` (gezet door ${stand.pauzeDoor})` : ""}.`,
    };
    await legVerversingVast(uitslag).catch(() => {});
    return NextResponse.json(uitslag);
  }

  const uitslag = await ververs();

  /* Altijd vastleggen — juist een mislukking moet in de portal te zien zijn.
     Een stil mislukte verversing betekent dat iedereen op oude data test en
     dat niemand het merkt. */
  await legVerversingVast(uitslag).catch(() => {});

  if (!uitslag.ok) console.error("[sandbox-verversen]", uitslag.stap, uitslag.melding);
  else console.log("[sandbox-verversen]", uitslag.melding);

  return NextResponse.json(uitslag, { status: uitslag.ok ? 200 : 500 });
}
