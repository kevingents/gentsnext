import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { emailFlowLeden, emailFlowStappen, mailGebeurtenissen, orders } from "@/db/schema";

/**
 * Meten wat een flow oplevert.
 *
 * ── Waarom een conversietelling geen uplift is ────────────────────────────
 * "43 van de 1.188 bestelden binnen zeven dagen" klinkt als een resultaat,
 * maar het is een waarneming: een deel van die 43 had sowieso besteld. Elk
 * pakket dat een uplift-percentage toont zonder controlegroep telt in
 * werkelijkheid gewoon aankopen ná een mail en noemt dat succes.
 *
 * Daarom twee getallen naast elkaar, en niet één:
 *
 *   NA DE MAIL   — wie kreeg hem, en wie bestelde daarna binnen het venster.
 *                  Eerlijk beschreven: een waarneming, geen bewijs.
 *   HOLDOUT      — een vast klein deel van de instappers krijgt bewust NIETS.
 *                  Zelfde selectie, zelfde moment, geen mail. Het verschil
 *                  tussen die twee groepen ís de opbrengst van de flow.
 *
 * Zonder de holdout weet je na een jaar nog steeds niet of de flow iets deed.
 * Mét is het de enige vergelijking die telt: flow versus geen flow. Een A/B op
 * de onderwerpregel is daarna pas interessant.
 *
 * ── Het meetvenster ──────────────────────────────────────────────────────
 * Zeven dagen na de mail. Bij de holdout rekenen we vanaf het INSTAPMOMENT,
 * want die krijgt geen mail — anders vergelijk je twee verschillende klokken.
 */

/** Standaard meetvenster in dagen. */
export const VENSTER_DAGEN = 7;

/** Statussen die als aankoop tellen — gelijk aan het 360-profiel. */
const AANKOOP = ["paid", "shipped", "ready_pickup", "delivered"];

export type FlowMeting = {
  /** Mensen die de mail kregen. */
  bereikt: number;
  /** Daarvan: hoeveel bestelden binnen het venster. */
  besteld: number;
  /** Omzet van die bestellingen, in centen. */
  omzetCents: number;
  /** besteld / bereikt, als fractie. */
  ratio: number;
};

export type FlowResultaten = {
  flowId: string;
  venster: number;
  mail: FlowMeting;
  holdout: FlowMeting;
  /** Verschil in conversieratio (mail − holdout), in procentpunten. */
  upliftPunten: number | null;
  /** Geschatte extra omzet per bereikte klant, in centen. */
  upliftPerKlantCents: number | null;
  /** Zonder holdout, of met een te kleine holdout, zeggen we dat gewoon. */
  uitleg: string;
};

/**
 * Wat leverde deze flow op?
 *
 * Twee losse tellingen in één statement, zodat de vergelijking altijd over
 * hetzelfde moment gaat. Neon-http kent geen transacties, dus twee losse
 * queries zouden een venster kunnen missen dat er net bij komt.
 */
export async function meetFlow(flowId: string, vensterDagen = VENSTER_DAGEN): Promise<FlowResultaten> {
  const db = getDb();
  const dagen = Math.max(1, Math.round(vensterDagen));

  const r = await db.execute<{
    groep: string;
    bereikt: number;
    besteld: number;
    omzet: number;
  }>(sql`
    with verzonden as (
      -- Per klant het EERSTE moment dat deze flow hem mailde. Een flow met vier
      -- mails mag niet vier keer dezelfde aankoop claimen.
      select s.customer_id cid, min(s.uitgevoerd_op) moment
      from ${emailFlowStappen} s
      where s.flow_id = ${flowId}::uuid and s.soort = 'mail' and s.gelukt
      group by 1
    ),
    holdout as (
      -- De controlegroep rekent vanaf het instapmoment: die kreeg geen mail,
      -- dus er is geen verzendmoment om vanaf te tellen.
      select l.customer_id cid, min(l.ingestapt_op) moment
      from ${emailFlowLeden} l
      where l.flow_id = ${flowId}::uuid and l.status = 'holdout'
      group by 1
    ),
    beide as (
      select 'mail' groep, cid, moment from verzonden
      union all
      select 'holdout', cid, moment from holdout
    ),
    -- Per persoon: bestelde hij binnen het venster, en voor hoeveel? Eerst per
    -- persoon samenvatten en dan pas optellen, anders telt iemand met drie
    -- orders drie keer mee in "besteld".
    per_persoon as (
      select b.groep, b.cid,
        coalesce(sum(o.total_cents), 0)::int omzet,
        count(o.id) > 0 kocht
      from beide b
      left join ${orders} o
        on o.customer_id = b.cid
       and o.status = any(${AANKOOP})
       and coalesce(o.paid_at, o.created_at) >= b.moment
       and coalesce(o.paid_at, o.created_at) < b.moment + make_interval(days => ${dagen}::int)
      group by 1, 2
    )
    select groep,
      count(*)::int bereikt,
      count(*) filter (where kocht)::int besteld,
      coalesce(sum(omzet), 0)::int omzet
    from per_persoon group by 1
  `);

  const pak = (groep: string): FlowMeting => {
    const rij = r.rows.find((x) => x.groep === groep);
    const bereikt = Number(rij?.bereikt ?? 0);
    const besteld = Number(rij?.besteld ?? 0);
    return {
      bereikt,
      besteld,
      omzetCents: Number(rij?.omzet ?? 0),
      ratio: bereikt ? besteld / bereikt : 0,
    };
  };

  const mail = pak("mail");
  const holdout = pak("holdout");

  /* Onder de honderd mensen in een groep is het verschil ruis. Dan liever geen
     getal dan een getal waar iemand een besluit op neemt: een uplift van "+3%"
     op 20 mensen is één toevallige bestelling. */
  const genoeg = mail.bereikt >= 100 && holdout.bereikt >= 100;
  const upliftPunten = genoeg ? (mail.ratio - holdout.ratio) * 100 : null;
  const upliftPerKlantCents = genoeg
    ? Math.round(mail.omzetCents / mail.bereikt - holdout.omzetCents / holdout.bereikt)
    : null;

  return {
    flowId,
    venster: dagen,
    mail,
    holdout,
    upliftPunten,
    upliftPerKlantCents,
    uitleg: !holdout.bereikt
      ? "Geen holdout ingesteld. De conversie hieronder is wat er ná de mail gebeurde — niet wat de flow veroorzaakte. Zet een holdout aan om dat verschil te kunnen zien."
      : !genoeg
        ? `Te weinig mensen voor een betrouwbaar verschil (mail ${mail.bereikt}, holdout ${holdout.bereikt}; vanaf 100 per groep tonen we het).`
        : `Vergelijking over ${dagen} dagen: ${mail.bereikt.toLocaleString("nl-NL")} kregen de flow, ${holdout.bereikt.toLocaleString("nl-NL")} bewust niet.`,
  };
}

/**
 * Per stap: verstuurd, geopend, geklikt, en wat er daarna besteld werd.
 *
 * Opens en kliks komen uit `mail_gebeurtenissen` — de Resend-webhook. Ze staan
 * BEWUST naast de bestellingen en niet in de plaats ervan: een openratio meet
 * of je onderwerpregel werkt, niet of de mail iets opleverde. De cijfers uit
 * het 360-profiel (`mail_engagement`) helpen hier niet, want die komen uit de
 * Spotler-export en gaan per e-mailadres over de hele historie.
 *
 * Opens zijn een ONDERGRENS, geen waarheid: Apple Mail Privacy Protection en
 * elke andere beeldblokkade laten een echte opening ontbreken. Kliks zijn
 * betrouwbaarder, en daarom staan die er ook bij.
 */
export async function meetPerStap(
  flowId: string,
  vensterDagen = VENSTER_DAGEN
): Promise<
  { stap: number; verstuurd: number; geopend: number; geklikt: number; besteld: number; omzetCents: number }[]
> {
  const db = getDb();
  const dagen = Math.max(1, Math.round(vensterDagen));
  const r = await db.execute<{
    stap: number;
    verstuurd: number;
    geopend: number;
    geklikt: number;
    besteld: number;
    omzet: number;
  }>(sql`
    with per_persoon as (
      select s.stap, s.id, s.lid_id,
        coalesce(sum(o.total_cents), 0)::int omzet,
        count(o.id) > 0 kocht
      from ${emailFlowStappen} s
      left join ${orders} o
        on o.customer_id = s.customer_id
       and o.status = any(${AANKOOP})
       and coalesce(o.paid_at, o.created_at) >= s.uitgevoerd_op
       and coalesce(o.paid_at, o.created_at) < s.uitgevoerd_op + make_interval(days => ${dagen}::int)
      where s.flow_id = ${flowId}::uuid and s.soort = 'mail' and s.gelukt
      group by 1, 2, 3
    ),
    -- Eén regel per persoon per stap: iemand die de mail vijf keer opende is
    -- één opening, anders meet je hoe vaak iemand zijn postvak ververst.
    betrokken as (
      select lid_id, stap,
        bool_or(soort = 'geopend') geopend,
        bool_or(soort = 'geklikt') geklikt
      from ${mailGebeurtenissen}
      where flow_id = ${flowId}::uuid and lid_id is not null
      group by 1, 2
    )
    select p.stap,
      count(*)::int verstuurd,
      count(*) filter (where b.geopend)::int geopend,
      count(*) filter (where b.geklikt)::int geklikt,
      count(*) filter (where p.kocht)::int besteld,
      coalesce(sum(p.omzet), 0)::int omzet
    from per_persoon p
    left join betrokken b on b.lid_id = p.lid_id and b.stap = p.stap
    group by 1 order by 1
  `);
  return r.rows.map((x) => ({
    stap: Number(x.stap),
    verstuurd: Number(x.verstuurd),
    geopend: Number(x.geopend),
    geklikt: Number(x.geklikt),
    besteld: Number(x.besteld),
    omzetCents: Number(x.omzet),
  }));
}
