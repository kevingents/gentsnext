import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { cronSecretOk } from "@/lib/cron-auth";
import {
  bronnenGeconfigureerd,
  haalReturnistaRetouren,
  haalSpotlerContacten,
  koppelSrsKlantnummers,
} from "@/lib/klantbronnen";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Externe klantbronnen ophalen: SRS-klantnummers en Returnista-retouren.
 *
 * Beide gaan via storegents, waar de clients en sleutels wonen. Zonder die
 * env-vars doet dit niets en meldt het dat expliciet — een stille lege uitkomst
 * is hier het gevaarlijkst, want dan lijkt het alsof er geen retouren zijn.
 *
 * De SRS-koppeling draait bewust maar één keer per dag: het is een volledige
 * lijst-vergelijking, en een klantnummer verandert zelden. De retouren elke
 * paar uur, want die zijn wél verse informatie.
 */
export async function GET(req: Request) {
  if (!cronSecretOk(req)) {
    const customer = await getSessionCustomer().catch(() => null);
    if (!customer?.isAdmin) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!bronnenGeconfigureerd()) {
    return NextResponse.json(
      { ok: false, error: "STOREGENTS_API_URL + STOREGENTS_PORTAL_SECRET ontbreken — bronnen staan uit." },
      { status: 412 },
    );
  }

  const url = new URL(req.url);
  const metSrs = url.searchParams.get("srs") !== "0";
  const dagen = Math.min(730, Math.max(1, Number(url.searchParams.get("dagen")) || 180));

  const uit: Record<string, unknown> = { ok: true };
  // Elke bron apart afvangen: valt Returnista uit, dan mag de SRS-koppeling
  // gewoon doorgaan. Eén gedeelde try zou van één storing twee maken.
  try {
    uit.retouren = await haalReturnistaRetouren(dagen);
  } catch (e) {
    uit.retouren = { fout: (e as Error).message };
  }
  try {
    // `veldnamen` komt bewust mee in het antwoord: per-contact open- en
    // klikcijfers staan niet in de gedocumenteerde Spotler-API, en of dit
    // account ze als custom property bijhoudt zie je pas bij de eerste échte
    // call. Zo vertelt de eerste run zelf wat er beschikbaar is, in plaats van
    // stil nullen te produceren.
    uit.spotler = await haalSpotlerContacten();
  } catch (e) {
    uit.spotler = { fout: (e as Error).message };
  }
  if (metSrs) {
    try {
      uit.srs = await koppelSrsKlantnummers();
    } catch (e) {
      uit.srs = { fout: (e as Error).message };
    }
  }
  return NextResponse.json(uit);
}
