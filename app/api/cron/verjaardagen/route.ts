import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getSessionCustomer } from "@/lib/account";
import { cronSecretOk } from "@/lib/cron-auth";
import { sendVerjaardagEmail, emailConfigured } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Verjaardagsmail — dagelijks.
 *
 * Het voorkeurenscherm op /account belooft dit letterlijk ("Voor een attentie
 * rond je verjaardag") en er stond niets tegenover: geen cron, geen template.
 * Een belofte in de UI die nergens op uitkomt is erger dan het veld niet vragen.
 *
 * Drie dingen die hier expres zo staan:
 *
 *  1. ÉÉN KEER PER JAAR, HARD. `verjaardag_mails` heeft (klant, jaar) als
 *     primaire sleutel en we claimen de rij vóór het versturen. Draait de cron
 *     twee keer, of start hij halverwege opnieuw, dan krijgt niemand een tweede
 *     felicitatie. Zonder die claim is een herstart een dubbele mail naar de
 *     hele lijst.
 *  2. TOESTEMMING GELDT OOK HIER. Een felicitatie is een aardigheid, maar het
 *     blijft een ongevraagd bericht: dezelfde bereikbaarheidsregel als bij de
 *     doelgroepen. Wie zich afmeldde krijgt niets.
 *  3. GEEN INHAALSLAG. Alleen wie vandaag jarig is. Bij een storing van drie
 *     dagen slaan we die dagen over in plaats van achteraf te feliciteren —
 *     "gefeliciteerd met eergisteren" is slechter dan zwijgen.
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
  const db = getDb();

  const jarig = await db.execute<{
    customer_id: string; email: string; voornaam: string;
    punten_beschikbaar: number; tegoed_cents: number;
  }>(sql`
    select p.customer_id, p.email, c.first_name voornaam,
           p.punten_beschikbaar, p.tegoed_cents
    from customer_profiles p
    join customers c on c.id = p.customer_id
    where p.verjaardag is not null
      and extract(month from p.verjaardag) = extract(month from current_date)
      and extract(day   from p.verjaardag) = extract(day   from current_date)
      and p.email <> ''
      -- Zelfde bereikbaarheidsregel als de doelgroepen: uitgeschreven wint
      -- altijd van een oudere opt-in.
      and p.nieuwsbrief <> 'unsubscribed'
      and (p.marketing_opt_in = true or p.nieuwsbrief = 'subscribed')
      and not exists (
        select 1 from verjaardag_mails v
        where v.customer_id = p.customer_id
          and v.jaar = extract(year from current_date)::int
      )
    limit 500
  `);

  if (proef) return NextResponse.json({ ok: true, proef: true, jarig: jarig.rows.length });

  let verstuurd = 0;
  let overgeslagen = 0;
  for (const k of jarig.rows) {
    // Eerst de rij claimen, dan pas mailen. Andersom stuur je bij een crash
    // tussen versturen en vastleggen morgen dezelfde mail nog eens.
    const claim = await db.execute(sql`
      insert into verjaardag_mails (customer_id, jaar)
      values (${k.customer_id}::uuid, extract(year from current_date)::int)
      on conflict do nothing
      returning customer_id
    `);
    if (!claim.rows.length) {
      overgeslagen++;
      continue;
    }
    const ok = await sendVerjaardagEmail(k.email, k.voornaam || "", {
      puntenBeschikbaar: k.punten_beschikbaar,
      tegoedCents: k.tegoed_cents,
    }).catch(() => false);
    if (ok) verstuurd++;
    else {
      // Mislukte verzending: claim terugdraaien zodat morgen een nieuwe poging
      // volgt. Een tijdelijke Resend-storing mag geen jaar kosten.
      await db.execute(sql`
        delete from verjaardag_mails
        where customer_id = ${k.customer_id}::uuid and jaar = extract(year from current_date)::int
      `);
      overgeslagen++;
    }
  }

  return NextResponse.json({ ok: true, jarig: jarig.rows.length, verstuurd, overgeslagen });
}
