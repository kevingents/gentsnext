import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { events } from "@/db/schema";
import { adminOrToken } from "@/lib/studio-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/experiments/results?id=<experiment> — de uitslag:
 * per variant het aantal bezoekers (sessies met een exposure), kopers,
 * conversie, omzet, en de vergelijking met de eerste variant (de controle).
 *
 * Bezoekers = DISTINCT sessies; een dubbele exposure (privémodus, gewist
 * localStorage) telt dus niet dubbel. Kwam een sessie ooit in twee varianten
 * terecht (gewichten tussentijds gewijzigd), dan telt hij deterministisch bij
 * de alfabetisch eerste — nooit bij allebei.
 *
 * De significantie is een tweezijdige z-toets op conversie tegen de controle.
 * "significant" = 95%. Belangrijker dan het vinkje: bij kleine aantallen zegt
 * de uitslag niets — daarom gaat het aantal bezoekers altijd mee terug en
 * rekent de portal pas een oordeel als beide kanten er minstens 100 hebben.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */

/** Standaardnormale verdeling (Abramowitz & Stegun 7.1.26) — geen dependency. */
function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const id = (new URL(req.url).searchParams.get("id") || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(id)) {
    return NextResponse.json({ ok: false, error: "Geen geldig experiment-id." }, { status: 400 });
  }

  try {
    const db = getDb();
    const rows = (
      await db.execute<{ variant: string; bezoekers: number; kopers: number; omzet_cents: string }>(sql`
        with exposed as (
          select session_id, min(split_part(handle, ':', 2)) as variant
          from ${events}
          where type = 'ab_exposure' and split_part(handle, ':', 1) = ${id} and session_id <> ''
          group by session_id
        ),
        koop as (
          select e.session_id, coalesce(sum(e.value_cents), 0) as cents
          from ${events} e
          join exposed x on x.session_id = e.session_id
          where e.type = 'purchase'
          group by e.session_id
        )
        select x.variant,
               count(*)::int as bezoekers,
               count(k.session_id)::int as kopers,
               coalesce(sum(k.cents), 0)::bigint as omzet_cents
        from exposed x
        left join koop k on k.session_id = x.session_id
        group by x.variant
        order by x.variant
      `)
    ).rows;

    const varianten = rows.map((r) => {
      const bezoekers = Number(r.bezoekers) || 0;
      const kopers = Number(r.kopers) || 0;
      return {
        variant: r.variant,
        bezoekers,
        kopers,
        conversiePct: bezoekers ? Math.round((kopers / bezoekers) * 10000) / 100 : 0,
        omzetCents: Number(r.omzet_cents) || 0,
      };
    });

    // Vergelijking met de controle (eerste variant op alfabet — per afspraak "A").
    const controle = varianten[0];
    const vergelijking = varianten.slice(1).map((v) => {
      const n1 = controle?.bezoekers || 0;
      const n2 = v.bezoekers;
      const x1 = controle?.kopers || 0;
      const x2 = v.kopers;
      const genoeg = n1 >= 100 && n2 >= 100;
      let z = 0;
      let pWaarde = 1;
      if (genoeg && n1 && n2) {
        const p1 = x1 / n1;
        const p2 = x2 / n2;
        const pool = (x1 + x2) / (n1 + n2);
        const se = Math.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n2));
        if (se > 0) {
          z = (p2 - p1) / se;
          pWaarde = 2 * (1 - phi(Math.abs(z)));
        }
      }
      return {
        variant: v.variant,
        upliftPct:
          controle && controle.conversiePct > 0
            ? Math.round(((v.conversiePct - controle.conversiePct) / controle.conversiePct) * 1000) / 10
            : null,
        genoegData: genoeg,
        z: Math.round(z * 100) / 100,
        pWaarde: Math.round(pWaarde * 1000) / 1000,
        significant: genoeg && pWaarde < 0.05,
      };
    });

    return NextResponse.json({ ok: true, id, varianten, vergelijking, controle: controle?.variant ?? null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
