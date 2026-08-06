import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getStores, DAYS } from "@/lib/stores";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/winkel-info — winkelgegevens + servicevoorwaarden voor documenten
 * die bij de KLANT terechtkomen (auth: STORE_CORE_TOKEN).
 *
 * WAAROM (Kevin, 6 aug): de pakbon in de doos moet vertellen uit welke winkel de
 * bestelling kwam, hoe je die winkel bereikt en hoe retourneren werkt. Die
 * gegevens staan al op de site (content/stores.json + de retour-instellingen);
 * ze een tweede keer in de kassa-code zetten zou betekenen dat een gewijzigde
 * openingstijd op de pakbon achterblijft. Eén bron dus.
 *
 * Body: { store: "GENTS Den Bosch" } → { ok, winkel, retour, klantenservice, website }
 */

/* Klantenservice-contact: zelfde nummer als op de site (help.errorCall /
   lib/support.ts). Via env te overschrijven zonder code-wijziging. */
const KS_EMAIL = process.env.CONTACT_EMAIL || "klantenservice@gents.nl";
const KS_TELEFOON = process.env.CONTACT_PHONE || "085 115 50 42";

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let body: { store?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }

  const gevraagd = norm(body?.store);
  const winkels = getStores();
  /* Match op volledige titel of op stadsnaam — de kassa kent "GENTS Den Bosch",
     SRS-afgeleide namen kunnen afwijken. */
  const w = winkels.find((s) => norm(s.title) === gevraagd)
    || winkels.find((s) => norm(s.city) === gevraagd)
    || winkels.find((s) => gevraagd.includes(norm(s.city)) && norm(s.city).length > 2)
    || null;

  const settings = await getSettings();
  const r = settings.returnConfig;

  return NextResponse.json({
    ok: true,
    winkel: w
      ? {
          naam: w.title,
          adres: w.address,
          plaats: w.city,
          telefoon: w.phone,
          openingstijden: DAYS.map((d) => ({ dag: d, tijden: String(w.hours?.[d] || "").trim() })),
        }
      : null,
    retour: {
      dagen: r.windowDays,
      kostenCent: r.dhlReturnCostCents,
      gratisMetTegoed: r.freeOnCredit,
    },
    klantenservice: { email: KS_EMAIL, telefoon: KS_TELEFOON },
    website: "gents.nl",
    aantalWinkels: winkels.length,
    /* Alle steden waar we een winkel hebben — op de pakbon een reden om langs te
       komen (Kevin, 6 aug: "misschien ook laten zien waar onze andere winkels
       zitten?"). Alfabetisch, ontdubbeld: twee winkels in één stad hoeven daar
       niet twee keer te staan. */
    steden: [...new Set(winkels.map((s) => String(s.city || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "nl")),
  });
}
