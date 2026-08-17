import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { REASON_NOTE_SEP } from "@/lib/retour-redenen.js";

/**
 * Wat de maatvoering in de praktijk doet: welke maten verkopen, welke komen
 * terug, en klopt het maatadvies met wat mensen uiteindelijk houden.
 *
 * SERVER-ONLY. Wordt gelezen door /api/studio/site/maten/analyse (Site → Maten).
 */

/**
 * De redenen die iets over MAATVOERING zeggen. "Kwaliteit valt tegen" en
 * "Beschadigd" horen er niet bij: die vertellen niets over of maat 52 te ruim
 * valt, en zouden het signaal alleen verdunnen. Labels, niet codes — de
 * database bewaart het NL-label (zie lib/retour-redenen.js).
 */
const REDEN_TE_KLEIN = "Te klein";
const REDEN_TE_GROOT = "Te groot";
const REDEN_LENGTE = "Mouw- of pijplengte klopt niet";
const REDEN_PASVORM = "Pasvorm of model staat me niet";

/** Het kale label zonder de vrije toelichting die de klant erachter mag typen. */
const REDEN_SQL = sql`split_part(coalesce(nullif(rl.reason, ''), r.reason), ${REASON_NOTE_SEP}, 1)`;

export type MaatRegel = {
  hoofdgroep: string;
  maat: string;
  verkocht: number;
  retour: number;
  retourPct: number;
  teKlein: number;
  teGroot: number;
  pasvorm: number;
};

export type MaatAnalyse = {
  van: string;
  tot: string;
  /** Orders ná deze datum zijn nog niet "uitgeretourneerd" — zie de uitleg hieronder. */
  rijpTot: string;
  retourtermijnDagen: number;
  regels: MaatRegel[];
  /**
   * Totalen over de hele periode, ook van de maten die door `minimumVerkocht`
   * afvielen. Nodig omdat een retourpercentage van 0,0% iets heel anders betekent
   * bij 3 retouren dan bij 3.000: de portal hoort te kunnen zeggen "gebaseerd op
   * N retouren" in plaats van een groen cijfer te tonen dat niets bewijst. Het
   * retourportal is nieuw, dus dit getal is voorlopig laag.
   */
  totaalVerkocht: number;
  totaalRetour: number;
  /** Retourregels zónder reden — die kunnen niet meedoen in de pasvorm-uitsplitsing. */
  retourZonderReden: number;
};

/**
 * Verkoop en retouren per maat, per hoofdgroep.
 *
 * Belangrijk: de retouren worden geteld op de datum van de ORDER, niet op de
 * datum van de retour. Anders vergelijk je retouren van vorige maand met de
 * verkoop van deze maand en ziet elke recente periode er kunstmatig goed uit.
 * De keerzijde is dat de laatste weken nog niet af zijn — daarom geeft deze
 * functie `rijpTot` terug: tot die datum is de reeks compleet, daarna loopt hij
 * nog vol. De portal hoort dat te zeggen in plaats van een dalend lijntje te
 * tonen dat geen daling is.
 */
export async function verkoopEnRetourenPerMaat(opts: {
  van: Date;
  tot: Date;
  retourtermijnDagen?: number;
  hoofdgroep?: string;
  minimumVerkocht?: number;
}): Promise<MaatAnalyse> {
  const db = getDb();
  const termijn = opts.retourtermijnDagen ?? 14;
  const minimum = Math.max(0, opts.minimumVerkocht ?? 5);
  const filter = (opts.hoofdgroep || "").trim();

  const rows = await db
    .execute<{
      hoofdgroep: string;
      maat: string;
      verkocht: number;
      retour: number;
      te_klein: number;
      te_groot: number;
      pasvorm: number;
      zonder_reden: number;
    }>(sql`
      with regels as (
        select
          coalesce(p.attributes->>'hoofdgroep_omschrijving', '') as hoofdgroep,
          btrim(ol.size) as maat,
          ol.id as regel_id,
          ol.order_id,
          ol.sku,
          ol.quantity
        from order_lines ol
        join orders o on o.id = ol.order_id
        left join product_variants v on v.sku = ol.sku
        left join products p on p.id = v.product_id
        where o.created_at >= ${opts.van.toISOString()}::timestamptz
          and o.created_at <  ${opts.tot.toISOString()}::timestamptz
          and coalesce(btrim(ol.size), '') <> ''
          and coalesce(o.status, '') not in ('cancelled', 'geannuleerd')
      ),
      retouren as (
        select
          rl.order_line_id,
          rl.sku,
          r.order_id,
          sum(rl.qty)::int as qty,
          sum(case when ${REDEN_SQL} = ${REDEN_TE_KLEIN} then rl.qty else 0 end)::int as te_klein,
          sum(case when ${REDEN_SQL} = ${REDEN_TE_GROOT} then rl.qty else 0 end)::int as te_groot,
          sum(case when ${REDEN_SQL} in (${REDEN_PASVORM}, ${REDEN_LENGTE}) then rl.qty else 0 end)::int as pasvorm,
          sum(case when coalesce(nullif(rl.reason, ''), nullif(r.reason, '')) is null then rl.qty else 0 end)::int as zonder_reden
        from return_lines rl
        join returns r on r.id = rl.return_id
        group by 1, 2, 3
      )
      select
        g.hoofdgroep,
        g.maat,
        sum(g.quantity)::int as verkocht,
        coalesce(sum(t.qty), 0)::int as retour,
        coalesce(sum(t.te_klein), 0)::int as te_klein,
        coalesce(sum(t.te_groot), 0)::int as te_groot,
        coalesce(sum(t.pasvorm), 0)::int as pasvorm,
        coalesce(sum(t.zonder_reden), 0)::int as zonder_reden
      from regels g
      -- Bij voorkeur op de orderregel koppelen; valt die weg (oudere retouren
      -- hebben geen order_line_id) dan op order + sku. Zonder die tweede weg
      -- verdwijnt een deel van de retouren stil uit de telling.
      left join retouren t
        on (t.order_line_id = g.regel_id)
        or (t.order_line_id is null and t.order_id = g.order_id and t.sku = g.sku)
      where g.hoofdgroep <> ''
        ${filter ? sql`and g.hoofdgroep = ${filter}` : sql``}
      group by 1, 2
      order by 1, sum(g.quantity) desc
    `)
    .then((r) => r.rows);

  const rijp = new Date(Math.min(opts.tot.getTime(), Date.now() - termijn * 24 * 60 * 60 * 1000));

  /* De totalen gaan over ÁLLE maten, ook die straks door `minimumVerkocht`
     wegvallen. Anders zou "gebaseerd op N retouren" de weggefilterde maten
     overslaan — juist het getal waarmee je wilt kunnen zeggen dat het nog te
     weinig is. Daarom filtert de query niet en doen we dat hieronder pas. */
  const totalen = rows.reduce(
    (a, r) => ({
      verkocht: a.verkocht + (Number(r.verkocht) || 0),
      retour: a.retour + (Number(r.retour) || 0),
      zonderReden: a.zonderReden + (Number(r.zonder_reden) || 0),
    }),
    { verkocht: 0, retour: 0, zonderReden: 0 },
  );

  return {
    van: opts.van.toISOString(),
    tot: opts.tot.toISOString(),
    rijpTot: rijp.toISOString(),
    retourtermijnDagen: termijn,
    totaalVerkocht: totalen.verkocht,
    totaalRetour: totalen.retour,
    retourZonderReden: totalen.zonderReden,
    regels: rows
      .filter((r) => (Number(r.verkocht) || 0) >= minimum)
      .map((r) => {
        const verkocht = Number(r.verkocht) || 0;
        const retour = Number(r.retour) || 0;
        return {
          hoofdgroep: String(r.hoofdgroep),
          maat: String(r.maat),
          verkocht,
          retour,
          retourPct: verkocht ? Math.round((retour / verkocht) * 1000) / 10 : 0,
          teKlein: Number(r.te_klein) || 0,
          teGroot: Number(r.te_groot) || 0,
          pasvorm: Number(r.pasvorm) || 0,
        };
      }),
  };
}

/* ─────────────────────────── Advieskwaliteit ─────────────────────────── */

export type AdviesKwaliteit = {
  /** Adviezen met een gekoppelde, gehouden aankoop — de enige die iets zeggen. */
  gemeten: number;
  /** Adviezen in de periode, ook zonder aankoop erna. */
  adviezenTotaal: number;
  /** Adviezen van ingelogde klanten (alleen die zijn te koppelen). */
  adviezenMetKlant: number;
  exact: number;
  eenMaatErnaast: number;
  verderWeg: number;
  /**
   * Gemiddeld verschil in maten (gekocht − geadviseerd). Positief = klanten
   * kopen groter dan wij adviseren, oftewel het advies valt te klein uit.
   */
  gemiddeldVerschil: number;
  /** Zelfde uitsplitsing, maar alleen voor wie zijn lichaamsmaten had ingevuld. */
  metEigenMeting: { gemeten: number; exact: number; gemiddeldVerschil: number };
  perMaat: { advies: string; n: number; exact: number; gemiddeldVerschil: number }[];
};

/**
 * Vergelijkt het uitgebrachte advies met wat de klant daarna kocht ÉN hield.
 *
 * "Hield" is het hele punt: een colbert dat besteld en teruggestuurd is, is geen
 * bewijs dat de maat klopte — eerder het tegendeel. Daarom tellen alleen regels
 * die niet in een retour voorkomen.
 *
 * Colbertmaten lopen in stappen van 2 (42, 44, 46…), dus een verschil van 2 is
 * "één maat ernaast". Alleen colberts en pakken: bij overhemden is de boordmaat
 * een reeks met een andere stapgrootte en die twee door elkaar tellen levert een
 * gemiddelde op dat niets betekent.
 */
export async function adviesKwaliteit(opts: { van: Date; tot: Date; vensterDagen?: number }): Promise<AdviesKwaliteit> {
  const db = getDb();
  const venster = opts.vensterDagen ?? 60;

  const [totalen] = await db
    .execute<{ totaal: number; met_klant: number }>(sql`
      select
        count(*)::int as totaal,
        count(*) filter (where klant_id is not null)::int as met_klant
      from maatadvies_log
      where created_at >= ${opts.van.toISOString()}::timestamptz
        and created_at <  ${opts.tot.toISOString()}::timestamptz
    `)
    .then((r) => r.rows);

  const rows = await db
    .execute<{ advies: string; gekocht: string; gemeten: boolean }>(sql`
      with advies as (
        select id, klant_id, created_at, advies_colbert, gemeten
        from maatadvies_log
        where klant_id is not null
          and advies_colbert ~ '^[0-9]+$'
          and created_at >= ${opts.van.toISOString()}::timestamptz
          and created_at <  ${opts.tot.toISOString()}::timestamptz
      ),
      gekocht as (
        select
          a.advies_colbert as advies,
          btrim(ol.size) as gekocht,
          a.gemeten,
          r.id as retour_id
        from advies a
        join orders o
          on o.customer_id = a.klant_id
         and o.created_at >= a.created_at
         and o.created_at <  a.created_at + make_interval(days => ${venster})
        join order_lines ol on ol.order_id = o.id
        left join product_variants v on v.sku = ol.sku
        left join products p on p.id = v.product_id
        -- Alleen wat op de colbertreeks zit; overhemden hebben een andere stap.
        left join return_lines rl
          on (rl.order_line_id = ol.id)
          or (rl.order_line_id is null and rl.sku = ol.sku)
        left join returns r on r.id = rl.return_id and r.order_id = o.id
        where coalesce(p.attributes->>'hoofdgroep_omschrijving', '') in ('Colberts', 'Pakken')
          and btrim(ol.size) ~ '^[0-9]+$'
          and coalesce(o.status, '') not in ('cancelled', 'geannuleerd')
      )
      select advies, gekocht, gemeten
      from gekocht
      where retour_id is null
    `)
    .then((r) => r.rows);

  const verschillen = rows.map((r) => ({
    advies: String(r.advies),
    verschil: Number(r.gekocht) - Number(r.advies),
    gemeten: r.gemeten === true,
  }));

  const tel = (lijst: typeof verschillen) => {
    const n = lijst.length;
    const exact = lijst.filter((x) => x.verschil === 0).length;
    const som = lijst.reduce((a, x) => a + x.verschil, 0);
    return { n, exact, gemiddeld: n ? Math.round((som / n) * 10) / 10 : 0 };
  };

  const alles = tel(verschillen);
  const gemetenLijst = tel(verschillen.filter((x) => x.gemeten));

  const perMaat = new Map<string, typeof verschillen>();
  for (const v of verschillen) {
    if (!perMaat.has(v.advies)) perMaat.set(v.advies, []);
    perMaat.get(v.advies)!.push(v);
  }

  return {
    gemeten: alles.n,
    adviezenTotaal: Number(totalen?.totaal) || 0,
    adviezenMetKlant: Number(totalen?.met_klant) || 0,
    exact: alles.exact,
    eenMaatErnaast: verschillen.filter((x) => Math.abs(x.verschil) === 2).length,
    verderWeg: verschillen.filter((x) => Math.abs(x.verschil) > 2).length,
    gemiddeldVerschil: alles.gemiddeld,
    metEigenMeting: { gemeten: gemetenLijst.n, exact: gemetenLijst.exact, gemiddeldVerschil: gemetenLijst.gemiddeld },
    perMaat: [...perMaat.entries()]
      .map(([advies, lijst]) => {
        const t = tel(lijst);
        return { advies, n: t.n, exact: t.exact, gemiddeldVerschil: t.gemiddeld };
      })
      .sort((a, b) => Number(a.advies) - Number(b.advies)),
  };
}
