import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { cronSecretOk } from "@/lib/cron-auth";
import { emailConfigured } from "@/lib/email";
import { loopFlows, vulAlleFlows } from "@/lib/email-flows";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * De loper van de e-mailflows. Elk kwartier.
 *
 * Twee dingen per ronde: nieuwe klanten laten instappen (voor flows met een
 * doelgroep-trigger), en de stappen uitvoeren die aan de beurt zijn.
 *
 * Waarom elk kwartier en niet elk uur: een wachtstap van vier uur wordt anders
 * in de praktijk vier tot vijf uur, en dat stapelt over meerdere stappen op tot
 * een flow die dagen uitloopt. Een kwartier is fijnmazig genoeg zonder de
 * database te belasten — de loper pakt alleen rijen waarvan het moment voorbij
 * is, en daar ligt een index op.
 *
 * `?proef=1` doet alleen het instappen en voert geen stappen uit; zo zie je wie
 * er in zou komen zonder dat er één mail vertrekt.
 */
export async function GET(req: Request) {
  if (!cronSecretOk(req)) {
    const customer = await getSessionCustomer().catch(() => null);
    if (!customer?.isAdmin) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!emailConfigured()) {
    return NextResponse.json({ ok: false, error: "Mailkanaal niet geconfigureerd" }, { status: 412 });
  }

  const url = new URL(req.url);
  const proef = url.searchParams.get("proef") === "1";

  try {
    const ingestapt = await vulAlleFlows();
    if (proef) return NextResponse.json({ ok: true, proef: true, ingestapt });

    const r = await loopFlows(Number(url.searchParams.get("max")) || 500);
    return NextResponse.json({ ok: true, ...r, ingestapt });
  } catch (e) {
    console.error("[cron/email-flows]", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
