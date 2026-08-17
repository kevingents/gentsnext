import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import {
  createReservation, getReservation, listReservations, listAllReservations,
  cancelReservation, markPickedUp, expireReservations, type ReservationLine,
} from "@/lib/reservations";
import { sendReserveringEmail } from "@/lib/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/reservation — gents.nl-native reservering (SRS = WMS, klant in
 * gents.nl). Action-based. Auth: STORE_CORE_TOKEN.
 *
 *   create   { location, customer:{customerId?,email?,name?,phone?}, lines:[...], reason?, note?, createdBy? }
 *   get      { id }
 *   list     { location, status?, limit? }
 *   cancel   { id, actor? }
 *   picked-up{ id }
 *   expire   {}                (cron)
 *
 * Klant-mail bij 'create' is TEST-gated: alleen @gents.nl tenzij RESERVERING_MAIL_ENABLED=1.
 */

function mailAllowed(email: string): boolean {
  return process.env.RESERVERING_MAIL_ENABLED === "1" || String(email || "").toLowerCase().endsWith("@gents.nl");
}

export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: {
    action?: string; id?: string; location?: string; status?: string; statuses?: string[]; limit?: number; actor?: string; createdBy?: string;
    customer?: { customerId?: string; email?: string; name?: string; phone?: string }; lines?: ReservationLine[]; reason?: string; note?: string;
  };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const action = String(b?.action || "");

  try {
    switch (action) {
      case "create": {
        if (!b.location) return NextResponse.json({ ok: false, error: "location vereist." }, { status: 400 });
        /* Winkel-kanaal: dit endpoint IS de kassa ("vraag aan" / apart leggen).
           Zonder web-veiligheidsmarge, anders kan de winkel het laatste stuk dat
           ze in handen heeft niet apart leggen (Kevin, 6 aug). */
        const r = await createReservation({ location: b.location, customer: b.customer || {}, lines: b.lines || [], reason: b.reason, note: b.note, createdBy: b.createdBy, channel: "store" });
        if (!r.ok || !r.reservation) return NextResponse.json(r, { status: 400 });
        const res = r.reservation;
        let mailed = false;
        if (res.customerEmail && mailAllowed(res.customerEmail)) {
          mailed = await sendReserveringEmail({
            to: res.customerEmail, name: res.customerName, store: res.location, validUntil: res.validUntil,
            lines: (res.lines as ReservationLine[]) || [], payToken: res.payToken,
          }).catch(() => false);
        }
        return NextResponse.json({ ok: true, reservation: res, mailed });
      }
      case "get": {
        const r = await getReservation(String(b.id || ""));
        return r ? NextResponse.json({ ok: true, reservation: r }) : NextResponse.json({ ok: false, error: "Niet gevonden." }, { status: 404 });
      }
      case "list": {
        if (!b.location) return NextResponse.json({ ok: false, error: "location vereist." }, { status: 400 });
        /* Eerst verlopen reserveringen omzetten, dán pas lezen. De voorraad kwam al
           vanzelf vrij (de hold heeft een eigen expires_at), maar de STATUS bleef
           "open" tot iemand toevallig de expire-actie aanriep. Bij 7 dagen viel dat
           niet op; bij een hold van 2 uur staat het winkeloverzicht anders vol met
           reserveringen die allang vervallen zijn. Non-fataal: kan het opruimen
           niet, dan tonen we gewoon de lijst. */
        await expireReservations().catch(() => null);
        return NextResponse.json({ ok: true, reservations: await listReservations(b.location, b.status, b.limit) });
      }
      case "overview": {
        // Supply-chain: alle reserveringen (alle winkels), default actief (open).
        const statuses = Array.isArray(b.statuses) && b.statuses.length ? b.statuses : ["open"];
        return NextResponse.json({ ok: true, reservations: await listAllReservations(statuses, b.limit) });
      }
      case "cancel":
        return NextResponse.json(await cancelReservation(String(b.id || ""), b.actor));
      case "picked-up": {
        const r = await markPickedUp(String(b.id || ""));
        return NextResponse.json({ ok: !!r, reservation: r });
      }
      case "expire":
        return NextResponse.json({ ok: true, ...(await expireReservations()) });
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${action}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
