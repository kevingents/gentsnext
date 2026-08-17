import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { createAppointment, listAppointmentsForStore, updateAppointmentStatus } from "@/lib/appointments";
import { stuurAfspraakMails, stuurAfspraakBevestigdMail } from "@/lib/afspraak-mail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Core-API klantafspraken — de kassa (storegents) leest hiermee de afspraken
 * van de eigen winkel en werkt de status bij. Auth: STORE_CORE_TOKEN of
 * admin/STUDIO_API_TOKEN (zelfde patroon als /api/core/stock/by-branch).
 *
 * GET  ?store=GENTS Amsterdam[&from=yyyy-mm-dd&to=yyyy-mm-dd]
 *      → { ok, items: [...] }  (default venster: vandaag t/m +14d, oplopend op datum)
 *      PII-arm: naam + telefoon (nodig om het tijdstip af te stemmen), géén e-mail.
 * POST { id, status }        → { ok }  (status ∈ nieuw|bevestigd|afgerond|no-show|geannuleerd)
 * POST { action:'create', … } → { ok, id, mailVerstuurd }  — de winkel plant zelf in;
 *      vandaag mag, de afspraak staat meteen op 'bevestigd' en de klant krijgt
 *      dezelfde bevestigingsmail als bij een online aanvraag.
 */
export async function GET(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const url = new URL(req.url);
  const store = url.searchParams.get("store") || "";
  if (!store.trim()) {
    return NextResponse.json({ ok: false, error: "store vereist." }, { status: 400 });
  }
  try {
    const items = await listAppointmentsForStore(store, url.searchParams.get("from") || undefined, url.searchParams.get("to") || undefined);
    if (items === null) {
      return NextResponse.json({ ok: false, error: "Onbekende winkel." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { id?: string; status?: string; tijd?: string; action?: string; type?: string; store?: string; preferredDate?: string; dagdeel?: string; name?: string; email?: string; phone?: string; wensen?: string; door?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }

  /* ZELF INPLANNEN vanuit de winkel (Kevin, 6 aug: "afspraken nu ook zelf een
     afspraak erin kunnen zetten met bevestiging naar de klant"). De klant staat
     aan de balie of belt; de winkel zet 'm erin en de klant krijgt dezelfde
     bevestigingsmail als bij een online aanvraag.

     Twee dingen anders dan online: vandaag mag ook (de "vanaf morgen"-regel is
     er om online-aanvragen te spreiden), en de afspraak staat meteen op
     'bevestigd' — er is net met de klant over gesproken. */
  if (String(body?.action || "") === "create") {
    try {
      const res = await createAppointment({
        type: String(body.type || ""),
        store: String(body.store || ""),
        preferredDate: String(body.preferredDate || ""),
        dagdeel: String(body.dagdeel || ""),
        tijd: String(body.tijd || ""),
        name: String(body.name || ""),
        email: String(body.email || ""),
        phone: String(body.phone || ""),
        wensen: String(body.wensen || ""),
        viaWinkel: true,
        ingepland_door: String(body.door || ""),
      });
      if (!res.ok) return NextResponse.json(res, { status: 400 });

      /* Mail is fail-soft: de afspraak stáát. Lukt de bevestiging niet, dan
         geven we dat terug zodat de kassa kan zeggen "bel de klant even".
         Mét tijdstip is de afspraak definitief → de bevestigde-variant; zonder
         tijd de ontvangstmail ("we bevestigen het tijdstip nog"). */
      const mail = res.tijd
        ? await stuurAfspraakBevestigdMail({
            id: res.id, type: res.type, store: res.store, preferredDate: res.preferredDate,
            dagdeel: res.dagdeel, tijd: res.tijd,
            name: String(body.name || ""), email: String(body.email || ""), locale: "nl",
          }).catch(() => ({ klantMail: false }))
        : await stuurAfspraakMails({
            type: res.type, store: res.store, preferredDate: res.preferredDate, dagdeel: res.dagdeel,
            name: String(body.name || ""), email: String(body.email || ""),
            phone: String(body.phone || ""), wensen: String(body.wensen || ""),
            viaWinkel: true,
          }).catch(() => ({ klantMail: false }));

      return NextResponse.json({ ok: true, id: res.id, store: res.store, preferredDate: res.preferredDate, mailVerstuurd: mail.klantMail });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }

  try {
    const status = String(body?.status || "");
    const res = await updateAppointmentStatus(String(body?.id || ""), status, String(body?.tijd || ""));
    if (!res.ok) return NextResponse.json(res, { status: 400 });

    /* Bij BEVESTIGEN krijgt de klant nu eindelijk de definitieve bevestiging —
       de ontvangstmail beloofde "de winkel neemt contact op om het tijdstip te
       bevestigen", en daarna bleef het stil. Het e-mailadres komt uit de
       database (de kassa ziet het bewust nooit). Fail-soft: mail mislukt ≠
       status terugdraaien; de kassa hoort het via mailVerstuurd. */
    let mailVerstuurd: boolean | undefined;
    if (status === "bevestigd") {
      const mail = await stuurAfspraakBevestigdMail(res.appointment).catch(() => ({ klantMail: false }));
      mailVerstuurd = mail.klantMail;
    }
    return NextResponse.json({ ok: true, tijd: res.appointment.tijd, ...(mailVerstuurd !== undefined ? { mailVerstuurd } : {}) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
