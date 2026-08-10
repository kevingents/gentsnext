import { NextResponse } from "next/server";
/* De sandbox-map is bewust JavaScript: exact hetzelfde bestand draait in
   storegents (dat geen TypeScript is). Zie scripts/sync-sandbox.mjs daar. */
import { isSandbox, sandboxNaam, sleutelKlachten } from "@/lib/sandbox/env.js";
import { PAD, lees, leesRegie } from "@/lib/sandbox/state.js";

/**
 * /api/sandbox — leesvenster op de nep-wereld van de WEBSITE.
 *
 * De schrijfkant (regie omzetten, resetten) zit bewust alleen in de portal:
 * één knop op één plek. Deze route bestaat zodat je vanaf de site kunt zien
 * dát je in een sandbox zit en wat het netwerkslot tegenhield — handig als een
 * tester meldt "de bevestigingsmail komt niet aan" (die komt namelijk in het
 * sandbox-postvak terecht, precies zoals bedoeld).
 *
 * Delen site en portal dezelfde blob-store (zelfde BLOB_READ_WRITE_TOKEN), dan
 * is het postvak één gezamenlijke lijst: een bestelling op de site en een bon
 * aan de kassa komen dan in hetzelfde overzicht. Dat is de aanbevolen opzet.
 *
 * Buiten de sandbox: 404. Productie hoort niet te verraden dat dit pad bestaat.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isSandbox()) {
    return NextResponse.json({ success: false, message: "Niet gevonden." }, { status: 404 });
  }

  const deel = new URL(req.url).searchParams.get("deel") || "status";

  if (deel === "postvak") {
    return NextResponse.json({ success: true, berichten: await lees(PAD.postvak, []) });
  }
  if (deel === "logboek") {
    return NextResponse.json({ success: true, regels: await lees(PAD.logboek, []) });
  }

  const klachten: string[] = sleutelKlachten();
  return NextResponse.json({
    success: true,
    onderdeel: "website",
    naam: sandboxNaam(),
    gezond: klachten.length === 0,
    verdachteSleutels: klachten,
    regie: await leesRegie(),
  });
}
