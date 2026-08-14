import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { adminOrToken } from "@/lib/studio-token";
import { PIM_CHECKS, PIM_MAX_SCORE, compleetheidScoreSql, miniatuurSql } from "@/lib/pim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Het kwaliteitsoverzicht van de catalogus: hoe compleet zijn de
 * productgegevens, en waar zit het gat.
 *
 * Dit is de reden dat een PIM meer is dan een bewerkscherm. Losse artikelen
 * bewerken kan iedereen; de vraag "welke 40 artikelen missen een maatadvies-
 * pasvorm" beantwoordt niemand door 2900 producten door te klikken.
 *
 * GET ?scope=levend|alles|actief  &merk=  &groep=
 *   scope 'levend'  (standaard) = alles behalve archived. Een gearchiveerd
 *                    artikel hoeft niet compleet te zijn en zou de score van de
 *                    catalogus onterecht omlaag trekken.
 *   scope 'actief'  = alleen status=active.
 *   scope 'alles'   = ook het archief.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const scope = sp.get("scope") || "levend";
  const merk = (sp.get("merk") || "").trim();
  const groep = (sp.get("groep") || "").trim();

  const conds = [
    scope === "actief" ? sql`p.status = 'active'` : scope === "alles" ? sql`1=1` : sql`p.status <> 'archived'`,
  ];
  if (merk) conds.push(sql`coalesce(nullif(p.vendor, ''), p.attributes ->> 'merk', '') = ${merk}`);
  if (groep) conds.push(sql`coalesce(p.attributes ->> 'hoofdgroep_omschrijving', '') = ${groep}`);
  const where = sql.join(conds, sql` and `);

  const score = compleetheidScoreSql();

  try {
    const db = getDb();

    /* Eén pass over de catalogus voor de kopcijfers. De score-expressie staat
       in een subquery zodat postgres 'm één keer uitrekent per rij in plaats
       van één keer per gebruik. */
    const totalenQ = db.execute<{
      n: string; gem: string; compleet: string; bijna: string; matig: string; slecht: string; vergrendeld: string;
    }>(sql`
      select count(*) n,
             coalesce(round(avg(s.score)), 0) gem,
             count(*) filter (where s.score = 100) compleet,
             count(*) filter (where s.score >= 80 and s.score < 100) bijna,
             count(*) filter (where s.score >= 50 and s.score < 80) matig,
             count(*) filter (where s.score < 50) slecht,
             count(*) filter (where jsonb_array_length(coalesce(s.slot, '[]'::jsonb)) > 0) vergrendeld
      from (
        select ${score} score, p.handmatige_velden slot
        from products p where ${where}
      ) s`);

    /* Per check: hoeveel artikelen falen 'm. Dit is de werklijst — "347 zonder
       pasvorm" is een opdracht, "gemiddelde score 78" is een gevoel. */
    const perCheckQ = db.execute<Record<string, string>>(sql`
      select ${sql.join(
        PIM_CHECKS.map((c) => sql`count(*) filter (where not (${c.conditie})) ${sql.identifier(`mist_${c.sleutel}`)}`),
        sql`, `,
      )}
      from products p where ${where}`);

    /* Waar zit het gat: per hoofdgroep en per merk. Beperkt tot de twintig
       grootste — een lijst van 300 merken is geen overzicht. */
    const perGroepQ = db.execute<{ naam: string; n: string; gem: string; onvolledig: string }>(sql`
      select coalesce(nullif(p.attributes ->> 'hoofdgroep_omschrijving', ''), '(geen categorie)') naam,
             count(*) n, coalesce(round(avg(${score})), 0) gem,
             count(*) filter (where (${score}) < 100) onvolledig
      from products p where ${where}
      group by 1 order by count(*) desc limit 20`);

    const perMerkQ = db.execute<{ naam: string; n: string; gem: string; onvolledig: string }>(sql`
      select coalesce(nullif(p.vendor, ''), nullif(p.attributes ->> 'merk', ''), '(geen merk)') naam,
             count(*) n, coalesce(round(avg(${score})), 0) gem,
             count(*) filter (where (${score}) < 100) onvolledig
      from products p where ${where}
      group by 1 order by count(*) desc limit 20`);

    /* De ergste gevallen: laagste score eerst, bij gelijke score het artikel met
       de meeste voorraad bovenaan — dat is het geld dat stilstaat.
       Het bekeken-cijfer komt er pas ná de LIMIT bij: als subquery in de
       select-lijst zou postgres 'm over álle 2900 rijen uitrekenen en dan
       vijftig overhouden. */
    const ergsteQ = db.execute<{
      handle: string; title: string; status: string; score: number; bekeken: string; image: string; stock_qty: number;
    }>(sql`
      select k.*,
             (select count(*) from events ev
               where ev.handle = k.handle and ev.type = 'product_view'
                 and ev.created_at > now() - interval '30 days') bekeken
      from (
        select p.handle, p.title, p.status, p.stock_qty, ${score} score,
               ${miniatuurSql()} image
        from products p where ${where}
      ) k
      where k.score < 100
      order by k.score asc, k.stock_qty desc limit 50`);

    const [totalen, perCheck, perGroep, perMerk, ergste] = await Promise.all([
      totalenQ,
      perCheckQ,
      perGroepQ,
      perMerkQ,
      ergsteQ.catch(() => ({ rows: [] as never[] })),
    ]);

    const t = totalen.rows[0];
    const c = perCheck.rows[0] || {};

    return NextResponse.json({
      ok: true,
      scope,
      maxScore: PIM_MAX_SCORE,
      totalen: {
        aantal: Number(t?.n) || 0,
        gemiddelde: Number(t?.gem) || 0,
        compleet: Number(t?.compleet) || 0,
        bijna: Number(t?.bijna) || 0,
        matig: Number(t?.matig) || 0,
        slecht: Number(t?.slecht) || 0,
        vergrendeld: Number(t?.vergrendeld) || 0,
      },
      checks: PIM_CHECKS.map((check) => ({
        sleutel: check.sleutel,
        label: check.label,
        gewicht: check.gewicht,
        uitleg: check.uitleg,
        mist: Number(c[`mist_${check.sleutel}`]) || 0,
      })).sort((a, b) => b.mist * b.gewicht - a.mist * a.gewicht),
      perGroep: perGroep.rows.map(rijNaarGroep),
      perMerk: perMerk.rows.map(rijNaarGroep),
      ergste: ergste.rows.map((r) => ({
        handle: r.handle,
        title: r.title,
        status: r.status,
        score: Number(r.score) || 0,
        bekeken30: Number(r.bekeken) || 0,
        image: r.image || "",
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

function rijNaarGroep(r: { naam: string; n: string; gem: string; onvolledig: string }) {
  return {
    naam: r.naam,
    aantal: Number(r.n) || 0,
    gemiddelde: Number(r.gem) || 0,
    onvolledig: Number(r.onvolledig) || 0,
  };
}
