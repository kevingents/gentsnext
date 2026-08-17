import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getSettings, updateSettings } from "@/lib/settings";
import { schoneActies, type PuntenActie } from "@/lib/punten-acties";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Eigen puntenacties: "koop dit, krijg extra punten".
 *
 * GET  → { ok, acties }
 * POST { acties: [...] } → de HELE lijst vervangen, gesaneerd teruggegeven
 *
 * Vervangen en niet patchen: de portal toont de volledige lijst, dus wat je daar
 * ziet is wat er komt te staan. Een halve patch levert anders een actie op die
 * niemand meer in beeld heeft maar wel punten uitdeelt.
 *
 * Een verwijderde actie stopt alleen met uitkeren; al toegekende punten blijven
 * staan. Dat is historie, geen instelling.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const acties = ((await getSettings()).puntenActies ?? []) as PuntenActie[];
  return NextResponse.json({ ok: true, acties });
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { acties?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const schoon = schoneActies(body.acties);
  /* Meld wat er afviel. De sanitizer gooit een actie zonder geldige slug of naam
     weg; zonder deze terugkoppeling zou het scherm "opgeslagen" tonen terwijl de
     actie nergens meer bestaat. */
  const ingestuurd = Array.isArray(body.acties) ? body.acties.length : 0;
  const geweigerd = Math.max(0, ingestuurd - schoon.length);

  await updateSettings({ puntenActies: schoon });
  return NextResponse.json({
    ok: true,
    acties: schoon,
    geweigerd,
    ...(geweigerd
      ? { waarschuwing: `${geweigerd} actie(s) geweigerd: een actie heeft een naam nodig en een unieke code van kleine letters, cijfers of streepjes.` }
      : {}),
  });
}
