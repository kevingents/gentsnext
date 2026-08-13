import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { cronSecretOk } from "@/lib/cron-auth";
import {
  bronnenGeconfigureerd,
  haalReturnistaRetouren,
  verrijkViaSpotler,
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
      { ok: false, error: "STOREGENTS_PORTAL_SECRET (of STORE_CORE_TOKEN) ontbreekt op gentsnext — externe bronnen staan uit." },
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
    /* Rollend ONZE klanten bij Spotler opvragen, N per run.
     *
     * Niet andersom. `GET contact` geeft er 250 terug en bladert niet — met
     * `page` kwam twintig keer dezelfde pagina terug, wat las als "5.000
     * opgehaald" en tot de conclusie leidde dat Spotler een heel ander
     * klantbestand zou bevatten. Het waren 250 mensen. Wíj weten wie onze
     * klanten zijn; we vragen per adres wat Spotler ervan weet. */
    uit.spotler = await verrijkViaSpotler(Number(url.searchParams.get("spotler")) || 500);
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
