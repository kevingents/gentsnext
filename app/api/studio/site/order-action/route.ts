import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getOrderByNumber, updateOrderStatus } from "@/lib/orders";
import { reportUnfulfillable, resolveUnfulfillable } from "@/lib/unfulfillable";
import {
  adresWijzigen,
  betaalstatusVernieuwen,
  bevestigingOpnieuw,
  logboekSchrijf,
  nieuweBetaallink,
  notitieToevoegen,
  orderAnnuleren,
  routeOpnieuw,
  terugbetalen,
} from "@/lib/order-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/studio/site/order-action — order-acties voor het portal-back-office
 * (Site → Bestellingen). Body: { orderNumber, action, … }.
 *
 *  - "status"              zet de order-status (+ statusmail naar de klant)
 *  - "unavailable"         meld regels niet-leverbaar (winkel)
 *  - "resolve-unavailable" handel een niet-leverbaar-melding af
 *  - "betaallink"          nieuwe Mollie-betaallink, optioneel mailen
 *  - "terugbetalen"        (deel)terugbetaling via Mollie
 *  - "betaalstatus"        status bij Mollie ophalen (gemiste webhook)
 *  - "annuleren"           onbetaalde bestelling terugdraaien
 *  - "bevestiging"         orderbevestiging opnieuw sturen
 *  - "adres"               bezorgadres/contactgegevens corrigeren
 *  - "route"               allocatie naar filialen opnieuw berekenen
 *  - "notitie"             interne notitie in het logboek
 *
 * De geld-acties zitten in lib/order-admin; deze route is alleen de deur:
 * authenticeren, invoer schoonmaken, doorgeven. `actor` (de portal-gebruiker)
 * komt van de BFF mee en gaat in het logboek — een terugbetaling zonder naam
 * erbij is achteraf niet uit te leggen.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }

  let body: {
    orderNumber?: unknown;
    action?: unknown;
    status?: unknown;
    store?: unknown;
    items?: unknown;
    reason?: unknown;
    actor?: unknown;
    mail?: unknown;
    amountCents?: unknown;
    adres?: unknown;
    notitie?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const orderNumber = String(body?.orderNumber || "").trim();
  const action = String(body?.action || "").trim();
  const actor = String(body?.actor || "").trim();
  const reden = String(body?.reason || "").trim();
  if (!orderNumber) {
    return NextResponse.json({ ok: false, error: "Geen ordernummer." }, { status: 400 });
  }

  try {
    const data = await getOrderByNumber(orderNumber);
    if (!data) {
      return NextResponse.json({ ok: false, error: "Order niet gevonden." }, { status: 404 });
    }

    if (action === "status") {
      const status = String(body?.status || "").trim();
      if (!status) {
        return NextResponse.json({ ok: false, error: "Geen status opgegeven." }, { status: 400 });
      }
      const ok = await updateOrderStatus(data.order.id, status);
      if (!ok) {
        return NextResponse.json({ ok: false, error: `Status "${status}" niet toegestaan.` }, { status: 400 });
      }
      // Ook de statuswijziging hoort in de tijdlijn: het is de meest gebruikte
      // handmatige ingreep en verstuurt een mail naar de klant.
      await logboekSchrijf({
        orderId: data.order.id,
        orderNumber,
        actie: "status",
        actor,
        notitie: `Status ${data.order.status} → ${status} (klant geïnformeerd)`,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "unavailable") {
      const store = String(body?.store || "").trim();
      const items = Array.isArray(body?.items)
        ? (body.items as { sku?: unknown; qty?: unknown }[]).map((i) => ({ sku: String(i?.sku || ""), qty: Number(i?.qty) || 1 }))
        : [];
      const res = await reportUnfulfillable(orderNumber, store, items, reden);
      return NextResponse.json(res, { status: res.ok ? 200 : 400 });
    }

    if (action === "resolve-unavailable") {
      const mode = String(body?.status || "").trim() === "return" ? "return" : "cancel";
      const res = await resolveUnfulfillable(orderNumber, mode);
      return NextResponse.json(res, { status: res.ok ? 200 : 400 });
    }

    if (action === "betaallink") {
      const res = await nieuweBetaallink(orderNumber, { actor, mail: body?.mail === true });
      return NextResponse.json(res, { status: res.ok ? 200 : 400 });
    }

    if (action === "terugbetalen") {
      const bedrag = Number(body?.amountCents);
      const res = await terugbetalen(orderNumber, bedrag, { actor, reden });
      return NextResponse.json(res, { status: res.ok ? 200 : 400 });
    }

    if (action === "betaalstatus") {
      const res = await betaalstatusVernieuwen(orderNumber, { actor });
      return NextResponse.json(res, { status: res.ok ? 200 : 400 });
    }

    if (action === "annuleren") {
      const res = await orderAnnuleren(orderNumber, { actor, reden });
      return NextResponse.json(res, { status: res.ok ? 200 : 400 });
    }

    if (action === "bevestiging") {
      const res = await bevestigingOpnieuw(orderNumber, { actor });
      return NextResponse.json(res, { status: res.ok ? 200 : 400 });
    }

    if (action === "adres") {
      const velden = (body?.adres && typeof body.adres === "object" ? body.adres : {}) as Record<string, unknown>;
      const res = await adresWijzigen(orderNumber, velden, { actor });
      return NextResponse.json(res, { status: res.ok ? 200 : 400 });
    }

    if (action === "route") {
      const res = await routeOpnieuw(orderNumber, { actor });
      return NextResponse.json(res, { status: res.ok ? 200 : 400 });
    }

    if (action === "notitie") {
      const res = await notitieToevoegen(orderNumber, String(body?.notitie || ""), { actor });
      return NextResponse.json(res, { status: res.ok ? 200 : 400 });
    }

    return NextResponse.json({ ok: false, error: "Onbekende actie." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
