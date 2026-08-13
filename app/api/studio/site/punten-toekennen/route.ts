import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { kenServicePuntenToe, serviceGrantsVanKlant } from "@/lib/punten-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Klantenservice: punten toekennen als coulance (na een klacht).
 *
 * GET  ?customerId=…            → { ok, grants }   het logboek van die klant
 * POST { customerId, punten, reden, actor, ticketId?, sleutel? }
 *                               → { ok, punten, saldo }
 *
 * `actor` komt van de portal (de ingelogde medewerker) en is verplicht: zonder
 * naam is het logboek waardeloos. De portal-BFF vult 'm server-side in, zodat
 * een medewerker niet iemand anders' naam kan meesturen.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const customerId = new URL(req.url).searchParams.get("customerId") || "";
  return NextResponse.json({ ok: true, grants: await serviceGrantsVanKlant(customerId) });
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let b: { customerId?: string; punten?: number; reden?: string; actor?: string; ticketId?: string; sleutel?: string };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const r = await kenServicePuntenToe({
    customerId: String(b.customerId || ""),
    punten: Number(b.punten) || 0,
    reden: String(b.reden || ""),
    actor: String(b.actor || ""),
    ticketId: String(b.ticketId || ""),
    sleutel: String(b.sleutel || ""),
  });
  // 400 bij een afgekeurde invoer: dan toont de portal de reden bij het veld.
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
