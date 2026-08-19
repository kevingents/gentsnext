import { NextResponse } from "next/server";
import { maakNieuweArtikelen, srsBeschikbaar } from "@/lib/srs-artikelen";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* Het volledige SRS-productenbestand ophalen en vergelijken kost tijd. */
export const maxDuration = 300;

/**
 * Nachtelijke cron (zie vercel.json): nieuwe SRS-artikelen als CONCEPT-product
 * het PIM in. Zo staat nieuwe collectie die fysiek de winkel in komt (Den
 * Bosch, drager T000001298) er 's ochtends al in — scanbaar bij de ontvangst,
 * zichtbaar met naam/kleur/maat/prijs, en voor content te vinden via het
 * Herkomst=SRS-filter in de productenlijst.
 *
 * Veiligheid zit in maakNieuweArtikelen zelf: noodrem op een verdacht kleine
 * feed, nooit aanmaken naast iets bestaands (sku- én artikelnummer+kleur-check),
 * en alles als 'draft' — de site toont niets tot content het afmaakt.
 *
 * Vercel-cron stuurt `Authorization: Bearer <CRON_SECRET>` mee.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  const url = new URL(req.url);
  return header === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!srsBeschikbaar()) {
    return NextResponse.json({ ok: false, error: "SRS_API_USER/SRS_API_PASSWORD ontbreken." }, { status: 503 });
  }
  try {
    const r = await maakNieuweArtikelen();
    if ("error" in r) return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
