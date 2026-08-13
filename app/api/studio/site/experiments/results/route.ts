import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { events } from "@/db/schema";
import { adminOrToken } from "@/lib/studio-token";
import { getExperiments, type AbDoel } from "@/lib/experiments";
import { oordeelKlaar, benodigdeSteekproef } from "@/lib/ab-regels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/experiments/results?id=<experiment> — de uitslag.
 *
 * Per variant: bezoekers (DISTINCT sessies met een exposure binnen het
 * meetvenster), de funnel (winkelwagen → checkout → aankoop), omzet en omzet
 * per bezoeker. De significantie is een tweezijdige z-toets op het DOEL van
 * het experiment (aankoop, winkelwagen of checkout) tegen de eerste variant.
 *
 * Meetvenster: alleen exposures ná gestartOp (en vóór gestoptOp) tellen — een
 * herstart begint met een schone lei, oude runs vervuilen de uitslag niet.
 *
 * SRM-waakhond: wijkt de gemeten verdeling af van de ingestelde gewichten
 * (chi-kwadraat, p < 0,001), dan klopt er iets aan de toewijzing of targeting
 * en is de hele uitslag verdacht — dat signaal gaat vóór elke significantie.
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

/** Kritieke chi-kwadraatwaarden bij p=0,001 voor df 1..5 (SRM-drempel). */
const CHI2_KRITIEK = [10.83, 13.82, 16.27, 18.47, 20.52];

const DOEL_LABEL: Record<AbDoel, string> = {
  purchase: "aankoop",
  add_to_cart: "in winkelwagen",
  checkout_start: "checkout gestart",
  product_click: "doorklik naar een product",
  product_view: "productpagina bekeken",
};

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const id = (new URL(req.url).searchParams.get("id") || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(id)) {
    return NextResponse.json({ ok: false, error: "Geen geldig experiment-id." }, { status: 400 });
  }

  try {
    const { experimenten } = await getExperiments();
    const exp = experimenten.find((e) => e.id === id);
    const doel: AbDoel = exp?.doel ?? "purchase";
    // Zonder venster (experiment van vóór de stempel, of verwijderd): alles.
    const vanaf = exp?.gestartOp ?? "1970-01-01T00:00:00.000Z";
    const tot = exp?.gestoptOp ?? "9999-01-01T00:00:00.000Z";

    const db = getDb();
    const rows = (
      await db.execute<{
        variant: string;
        bezoekers: number;
        doorklikken: number;
        productpaginas: number;
        winkelwagen: number;
        checkout: number;
        kopers: number;
        omzet_cents: string;
      }>(sql`
        with exposed as (
          select session_id, min(split_part(handle, ':', 2)) as variant
          from ${events}
          where type = 'ab_exposure'
            and split_part(handle, ':', 1) = ${id}
            and session_id <> ''
            and created_at >= ${vanaf}::timestamptz
            and created_at <= ${tot}::timestamptz
          group by session_id
        ),
        stappen as (
          select x.variant,
                 count(distinct e.session_id) filter (where e.type = 'product_click') as doorklikken,
                 count(distinct e.session_id) filter (where e.type = 'product_view') as productpaginas,
                 count(distinct e.session_id) filter (where e.type = 'add_to_cart') as winkelwagen,
                 count(distinct e.session_id) filter (where e.type = 'checkout_start') as checkout,
                 count(distinct e.session_id) filter (where e.type = 'purchase') as kopers,
                 coalesce(sum(e.value_cents) filter (where e.type = 'purchase'), 0) as omzet_cents
          from ${events} e
          join exposed x on x.session_id = e.session_id
          where e.type in ('product_click', 'product_view', 'add_to_cart', 'checkout_start', 'purchase')
            and e.created_at >= ${vanaf}::timestamptz
          group by x.variant
        )
        select x.variant,
               count(*)::int as bezoekers,
               coalesce(max(s.doorklikken), 0)::int as doorklikken,
               coalesce(max(s.productpaginas), 0)::int as productpaginas,
               coalesce(max(s.winkelwagen), 0)::int as winkelwagen,
               coalesce(max(s.checkout), 0)::int as checkout,
               coalesce(max(s.kopers), 0)::int as kopers,
               coalesce(max(s.omzet_cents), 0)::bigint as omzet_cents
        from exposed x
        left join stappen s on s.variant = x.variant
        group by x.variant
        order by x.variant
      `)
    ).rows;

    const varianten = rows.map((r) => {
      const bezoekers = Number(r.bezoekers) || 0;
      const doorklikken = Number(r.doorklikken) || 0;
      const productpaginas = Number(r.productpaginas) || 0;
      const winkelwagen = Number(r.winkelwagen) || 0;
      const checkout = Number(r.checkout) || 0;
      const kopers = Number(r.kopers) || 0;
      const omzetCents = Number(r.omzet_cents) || 0;
      // Eén tabel: elk doel wijst naar zijn eigen kolom. product_click en
      // product_view horen bij lijstpagina's — daar is "aankoop" zo ver weg
      // dat je weken wacht op een uitslag die vooral over de PDP gaat.
      const perDoel: Record<AbDoel, number> = {
        purchase: kopers,
        add_to_cart: winkelwagen,
        checkout_start: checkout,
        product_click: doorklikken,
        product_view: productpaginas,
      };
      const doelN = perDoel[doel];
      return {
        variant: r.variant,
        bezoekers,
        doorklikken,
        productpaginas,
        winkelwagen,
        checkout,
        kopers,
        omzetCents,
        omzetPerBezoekerCents: bezoekers ? Math.round(omzetCents / bezoekers) : 0,
        doelN,
        conversiePct: bezoekers ? Math.round((doelN / bezoekers) * 10000) / 100 : 0,
      };
    });

    // SRM: klopt de gemeten verdeling met de ingestelde gewichten? Zo niet,
    // dan is er iets mis met de toewijzing en is élke conclusie verdacht.
    let srm: { chi2: number; waarschuwing: boolean } | null = null;
    if (exp && varianten.length >= 2) {
      const totaalBezoekers = varianten.reduce((s, v) => s + v.bezoekers, 0);
      const totaalGewicht = exp.varianten.reduce((s, v) => s + v.gewicht, 0) || 1;
      if (totaalBezoekers >= 200) {
        let chi2 = 0;
        let geldig = true;
        for (const v of varianten) {
          const gewicht = exp.varianten.find((x) => x.key === v.variant)?.gewicht;
          if (gewicht === undefined) { geldig = false; break; }
          const verwacht = (gewicht / totaalGewicht) * totaalBezoekers;
          if (verwacht < 5) { geldig = false; break; } // chi-kwadraat onbetrouwbaar
          chi2 += ((v.bezoekers - verwacht) ** 2) / verwacht;
        }
        if (geldig) {
          const kritiek = CHI2_KRITIEK[Math.min(varianten.length - 2, CHI2_KRITIEK.length - 1)];
          srm = { chi2: Math.round(chi2 * 100) / 100, waarschuwing: chi2 > kritiek };
        }
      }
    }

    /* Peeking-rem. Wie elke dag naar een p-waarde kijkt en stopt zodra die
       onder 0,05 duikt, vindt vroeg of laat altijd een "winnaar" — ook als er
       niets aan de hand is. De rem is niet een strengere drempel maar het
       enige dat echt werkt: geen uitslag tónen vóór de vooraf afgesproken
       looptijd én steekproef gehaald zijn. Tot die tijd zie je wél de
       aantallen (en de SRM-waakhond), maar geen oordeel. */
    const controle = varianten[0];
    const nu = Date.now();
    const start = exp?.gestartOp ? new Date(exp.gestartOp).getTime() : 0;
    const eind = exp?.gestoptOp ? new Date(exp.gestoptOp).getTime() : nu;
    const dagenGelopen = start ? Math.max(0, (Math.min(eind, nu) - start) / 86400000) : 0;
    const kleinsteVariant = varianten.length ? Math.min(...varianten.map((v) => v.bezoekers)) : 0;

    /* Hoeveel bezoekers zijn er nodig? Niet uit de duim, maar uit de gemeten
       basisconversie van de controle plus het effect dat je vóóraf zei te
       willen zien. Dat maakt het doel eerlijk én zelfcorrigerend: valt de
       conversie in werkelijkheid lager uit, dan stijgt de benodigde steekproef
       automatisch mee. Een handmatig doel wint als het is ingevuld. */
    const berekendDoel = benodigdeSteekproef(controle?.conversiePct ?? 0, exp?.verwachtEffectPct ?? 15);
    const doelPerVariant = Math.max(100, exp?.doelBezoekersPerVariant || berekendDoel || 0);

    const venster = oordeelKlaar({
      dagenGelopen,
      // Zonder startstempel (experiment van vóór het meetvenster) weten we niet
      // hoe lang hij liep. Dan geen looptijd-eis stellen — anders zou zo'n
      // experiment nooit meer een uitslag krijgen, terwijl hij al weken draait.
      minDagen: start ? exp?.minLooptijdDagen ?? 7 : 0,
      kleinsteVariant,
      doelPerVariant,
    });
    // Tempo in het venster: hiermee kan de portal zeggen hoevéél dagen er nog
    // te gaan zijn in plaats van alleen "nog niet klaar".
    const bezoekersPerDag =
      dagenGelopen >= 0.5 ? Math.round(varianten.reduce((s, v) => s + v.bezoekers, 0) / dagenGelopen) : 0;
    // Nog te gaan, in dagen — op basis van de kleinste variant, want die is de
    // bottleneck bij een 90/10-verdeling.
    const aandeelKleinste = kleinsteVariant && dagenGelopen >= 0.5 ? kleinsteVariant / dagenGelopen : 0;
    const dagenTeGaan =
      venster.klaar || !aandeelKleinste ? 0 : Math.ceil((doelPerVariant - kleinsteVariant) / aandeelKleinste);

    // Tweezijdige z-toets op het doel, tegen de eerste variant (de controle).
    const vergelijking = varianten.slice(1).map((v) => {
      const n1 = controle?.bezoekers || 0;
      const n2 = v.bezoekers;
      const x1 = controle?.doelN || 0;
      const x2 = v.doelN;
      const genoeg = venster.klaar && n1 >= 100 && n2 >= 100;
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

    return NextResponse.json({
      ok: true,
      id,
      doel,
      doelLabel: DOEL_LABEL[doel],
      // Oppervlak mee terug: "3,1% doorklik" betekent iets anders op een
      // lijstpagina dan site-breed, en de portal moet dat kunnen labelen.
      oppervlak: exp?.oppervlak ?? "site",
      gestartOp: exp?.gestartOp ?? null,
      gestoptOp: exp?.gestoptOp ?? null,
      varianten,
      vergelijking,
      controle: controle?.variant ?? null,
      srm,
      venster: {
        dagenGelopen: Math.round(dagenGelopen * 10) / 10,
        minLooptijdDagen: exp?.minLooptijdDagen ?? 7,
        doelPerVariant,
        doelZelfBerekend: !exp?.doelBezoekersPerVariant,
        verwachtEffectPct: exp?.verwachtEffectPct ?? 15,
        kleinsteVariant,
        bezoekersPerDag,
        dagenTeGaan,
        klaar: venster.klaar,
        reden: venster.reden,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
