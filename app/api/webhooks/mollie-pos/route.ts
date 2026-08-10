import { NextResponse } from "next/server";
import { getMolliePayment, mollieTerminalConfigured } from "@/lib/mollie";
import { meldPinStatusAanKassa } from "@/lib/pin-terminal-melding";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Mollie-webhook voor PINBETALINGEN AAN DE KASSA (point-of-sale).
 *
 * Bewust een EIGEN route, los van /api/webhooks/mollie: die verwerkt webshop-
 * orders, cadeaubonnen en reserveringen. Een winkelbetaling is geen van drieën —
 * daar hoort geen order-afhandeling, geen bevestigingsmail en geen allocatie bij.
 *
 * WAAROM DEZE ER IS. Een pinbetaling leefde alleen in het browsertabblad van de
 * kassa: daar stond het betaal-id, daar draaide de status-poll. Viel dat tabblad
 * weg, of de pc, dan wist niemand meer dát er een betaling liep. Geld binnen,
 * geen bon, geen spoor — en anders dan bij Worldline is er geen driverlog om
 * tegen af te vinken. Deze webhook komt ongeacht wat de kassa doet.
 *
 * LET OP — DE SLEUTEL. De betaling is met de TERMINALsleutel aangemaakt en moet
 * daar ook mee opgevraagd worden. Sinds 10 aug zijn webshop en terminal
 * gesplitst (MOLLIE_TERMINAL_API_KEY); met de webshop-sleutel bestaat deze
 * betaling niet en zou de webhook stil niets doen.
 *
 * Mollie POST't alleen een id (form-encoded); de status halen we zelf op — dat
 * is de bron van waarheid. Idempotent: Mollie mag dezelfde webhook herhalen.
 */
export async function POST(req: Request) {
  /* Niet geconfigureerd: 200, anders blijft Mollie eindeloos herhalen op een
     omgeving die hier toch niets mee kan. */
  if (!mollieTerminalConfigured()) return NextResponse.json({ ok: true });

  let id = "";
  try {
    const form = await req.formData();
    id = String(form.get("id") || "");
  } catch {
    try {
      const text = await req.text();
      id = new URLSearchParams(text).get("id") || "";
    } catch {
      /* leeg laten */
    }
  }
  if (!id) return NextResponse.json({ ok: false, error: "geen id" }, { status: 400 });

  try {
    const payment = await getMolliePayment(id, { terminal: true });
    const meta = (payment.metadata || {}) as Record<string, unknown>;

    /* Alleen kassabetalingen. De metadata `source:"pos-terminal"` wordt bij het
       aanmaken gezet (app/api/core/pos-pin). Komt hier iets anders binnen — een
       webshoporder op een verkeerd ingestelde webhook — dan houden we er onze
       handen vanaf: 200 zodat Mollie stopt met herhalen, maar we raken de
       administratie van de kassa niet aan. */
    if (String(meta.source || "") !== "pos-terminal") {
      console.warn(`[webhooks/mollie-pos] ${id}: geen kassabetaling (source=${String(meta.source || "")}) — genegeerd.`);
      return NextResponse.json({ ok: true, ignored: true });
    }

    const amountCents = Math.round(parseFloat(payment.amount?.value || "0") * 100);
    const gemeld = await meldPinStatusAanKassa({
      paymentId: payment.id,
      status: payment.status,
      amountCents,
      store: typeof meta.store === "string" ? meta.store : "",
      clientRef: typeof meta.clientRef === "string" ? meta.clientRef : "",
    });

    /* Niet aangekomen → 500, zodat MOLLIE het opnieuw stuurt. Hier 200 teruggeven
       zou de melding stil laten verdwijnen: precies het gat dat deze route dicht. */
    if (!gemeld) {
      return NextResponse.json({ ok: false, error: "niet doorgegeven" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(`[webhooks/mollie-pos] ${id}:`, (e as Error).message);
    return NextResponse.json({ ok: false, error: "verwerken mislukt" }, { status: 500 });
  }
}
