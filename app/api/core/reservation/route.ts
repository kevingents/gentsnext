import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import {
  createReservation, getReservation, listReservations,
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
    action?: string; id?: string; location?: string; status?: string; limit?: number; actor?: string; createdBy?: string;
    customer?: { customerId?: string; email?: string; name?: string; phone?: string }; lines?: ReservationLine[]; reason?: string; note?: string;
  };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const action = String(b?.action || "");

  try {
    switch (action) {
      case "create": {
        if (!b.location) return NextResponse.json({ ok: false, error: "location vereist." }, { status: 400 });
        const r = await createReservation({ location: b.location, customer: b.customer || {}, lines: b.lines || [], reason: b.reason, note: b.note, createdBy: b.createdBy });
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
        return NextResponse.json({ ok: true, reservations: await listReservations(b.location, b.status, b.limit) });
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
