import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { koppelStand, koppelUitAttributen, koppelUitSrs, maakNieuweArtikelen, srsBeschikbaar } from "@/lib/srs-artikelen";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* Het volledige SRS-productenbestand ophalen én matchen kost tijd. */
export const maxDuration = 300;

/**
 * De SRS-koppeling op productniveau, vanuit de portal.
 *
 * GET  → de stand: hoeveel producten hebben een artikelnummer, een kleur-id, en
 *        zijn daadwerkelijk in de SRS-feed gezien.
 * POST { bron?: "srs" | "attributen", delta?: boolean, droogdraaien?: boolean }
 *        → koppelen.
 *
 * Zonder `bron` kiest hij SRS als de inloggegevens er zijn, anders de brondata.
 * `droogdraaien` telt alleen — handig om te zien wat er zou gebeuren voordat je
 * 2.900 producten aanraakt.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    return NextResponse.json({ ok: true, srsBeschikbaar: srsBeschikbaar(), stand: await koppelStand() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { actie?: unknown; bron?: unknown; delta?: unknown; droogdraaien?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const droogdraaien = body.droogdraaien === true;
  const delta = body.delta === true;
  const bron = String(body.bron || "") || (srsBeschikbaar() ? "srs" : "attributen");

  /* actie 'aanmaken': nieuwe SRS-artikelen als concept-product het PIM in
     (attributes.bron = 'SRS', status draft). Koppelen raakt bestaande producten,
     aanmaken alleen wat nog nergens bestaat — bewust twee losse werkwoorden. */
  if (String(body.actie || "") === "aanmaken") {
    try {
      const r = await maakNieuweArtikelen({ droogdraaien });
      if ("error" in r) return NextResponse.json({ ok: false, error: r.error }, { status: 422 });
      return NextResponse.json({ ok: true, resultaat: r, stand: await koppelStand() });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }

  try {
    const r =
      bron === "srs"
        ? await koppelUitSrs({ delta, droogdraaien })
        : await koppelUitAttributen(droogdraaien);
    if ("error" in r) return NextResponse.json({ ok: false, error: r.error }, { status: 422 });
    return NextResponse.json({ ok: true, resultaat: r, stand: await koppelStand() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
