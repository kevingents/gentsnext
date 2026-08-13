import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { heatmapKlikken, heatmapScroll } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import {
  apparaatVoorBreedte,
  isApparaat,
  isKlikSoort,
  magLabelVastleggen,
  medianeUitBuckets,
  paginaSjabloon,
  schoonLabel,
  titelVoorPagina,
  CEL_KOLOMMEN,
  CEL_RIJ_PX,
  type Apparaat,
  type KlikSoort,
} from "@/lib/heatmap-paginas";

/**
 * Serverkant van de klik-heatmap: opslaan, samenvatten en uitlezen.
 *
 * DE DAG IS EEN NEDERLANDSE DAG. Overal `at time zone 'Europe/Amsterdam'`, niet
 * de kale datum van een timestamptz — die valt in Neon op UTC en dan schuift een
 * klik van 's avonds elf naar de volgende dag. Dezelfde fout stond eerder op de
 * kassabonnen; hier zou hij de dagtotalen scheeftrekken en, erger, de grens
 * tussen "al samengevat" en "nog ruw" één dag laten verspringen.
 *
 * TWEE LAGEN, ÉÉN ANTWOORD. Alles tot en met gisteren staat samengevat in
 * heatmap_cellen / _elementen / _scroll_dag; vandaag zit nog in het ruwe
 * materiaal. Elke uitleesquery plakt die twee aan elkaar op de grens
 * `max(dag) + 1` uit de samenvattingstabel zelf. Zo kan er niets dubbel geteld
 * worden (de rollup is idempotent per dag) en ontstaat er geen gat als de cron
 * een nacht overslaat: die dag zit dan gewoon nog in het ruwe deel.
 */

/* ────────────────────────────── Opslaan ────────────────────────────────── */

export type HeatKlikBinnen = {
  x?: number;
  y?: number;
  ox?: number;
  oy?: number;
  sel?: string;
  label?: string;
  soort?: string;
};

export type HeatBinnen = {
  pagina?: string;
  pad?: string;
  apparaat?: string;
  sessie?: string;
  docHoogte?: number;
  vensterBreedte?: number;
  vensterHoogte?: number;
  klikken?: HeatKlikBinnen[];
  scrollPct?: number | null;
};

const MAX_KLIKKEN_PER_BATCH = 60;

const heel = (v: unknown, min: number, max: number, standaard = 0): number => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return standaard;
  return Math.min(max, Math.max(min, n));
};

/**
 * FNV-1a. Bepaalt of een sessie in de steekproef zit — met een hash en niet met
 * Math.random(), zodat een sessie bij élke batch dezelfde kant op valt. Anders
 * zit de helft van iemands kliks er wel in en de andere helft niet, en dan
 * vergelijk je twee knoppen op dezelfde pagina met verschillende noemers.
 */
function inSteekproef(sessie: string, pct: number): boolean {
  if (pct >= 100) return true;
  if (pct <= 0) return false;
  if (!sessie) return false;
  let h = 0x811c9dc5;
  for (let i = 0; i < sessie.length; i++) {
    h ^= sessie.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100 < pct;
}

/**
 * Slaat één batch op. Geeft terug wat er bewaard is, zodat /api/heatmap kan
 * loggen wanneer er niets doorkomt — een heatmap die stilletjes leeg blijft is
 * erger dan geen heatmap, want je gaat conclusies trekken uit het niets.
 */
export async function bewaarHeatmap(binnen: HeatBinnen): Promise<{ klikken: number; scroll: number; reden?: string }> {
  const { heatmap } = await getSettings();
  if (!heatmap.aan) return { klikken: 0, scroll: 0, reden: "uit" };

  // Sjabloon opnieuw afleiden uit het ECHTE pad. Wat de client als `pagina`
  // meestuurt is een bewering; met een aangepaste client zou je daarmee kliks
  // onder een pagina kunnen schuiven die helemaal niet gemeten wordt.
  const paginaKey = paginaSjabloon(binnen.pad || "") || paginaSjabloon(binnen.pagina || "");
  if (!paginaKey) return { klikken: 0, scroll: 0, reden: "pagina-niet-gemeten" };

  const sessie = String(binnen.sessie || "").slice(0, 64);
  if (!inSteekproef(sessie, heel(heatmap.steekproefPct, 0, 100, 100))) {
    return { klikken: 0, scroll: 0, reden: "buiten-steekproef" };
  }

  const vensterBreedte = heel(binnen.vensterBreedte, 0, 10000);
  const apparaat: Apparaat = isApparaat(binnen.apparaat)
    ? binnen.apparaat
    : apparaatVoorBreedte(vensterBreedte || 1024);
  const pad = String(binnen.pad || "").split("?")[0].slice(0, 300);
  const docHoogte = heel(binnen.docHoogte, 0, 500000);
  const magLabel = magLabelVastleggen(paginaKey);

  const klikRijen = (Array.isArray(binnen.klikken) ? binnen.klikken : [])
    .slice(0, MAX_KLIKKEN_PER_BATCH)
    .map((k) => ({
      paginaKey,
      pad,
      apparaat,
      sessionId: sessie,
      x: heel(k?.x, 0, 1000),
      y: heel(k?.y, 0, 200000),
      ox: heel(k?.ox, 0, 1000),
      oy: heel(k?.oy, 0, 1000),
      selector: String(k?.sel || "").slice(0, 200),
      // Ook hier schoonmaken, niet alleen in de browser: de server is de enige
      // plek die niet aan te passen is door wie de pagina open heeft staan.
      label: magLabel ? schoonLabel(String(k?.label || "")) : "",
      soort: (isKlikSoort(k?.soort) ? k.soort : "klik") as KlikSoort,
      docHoogte,
      vensterBreedte,
    }));

  const db = getDb();
  if (klikRijen.length) await db.insert(heatmapKlikken).values(klikRijen);

  let scroll = 0;
  if (binnen.scrollPct !== null && binnen.scrollPct !== undefined) {
    await db.insert(heatmapScroll).values({
      paginaKey,
      apparaat,
      sessionId: sessie,
      maxPct: heel(binnen.scrollPct, 0, 100),
      docHoogte,
      vensterHoogte: heel(binnen.vensterHoogte, 0, 10000),
    });
    scroll = 1;
  }
  return { klikken: klikRijen.length, scroll };
}

/* ────────────────────────────── Uitlezen ───────────────────────────────── */

const NL_DAG = sql`(created_at at time zone 'Europe/Amsterdam')::date`;

/** Rij-index in het raster: 20 CSS-pixels per rij. */
const CY = sql.raw(`(y / ${CEL_RIJ_PX})`);
/** Kolom-index: x staat in promille, 50 kolommen breed. */
const CX = sql.raw(`least(x / ${Math.round(1000 / CEL_KOLOMMEN)}, ${CEL_KOLOMMEN - 1})`);

const q = <T extends Record<string, unknown>>(s: ReturnType<typeof sql>) =>
  getDb()
    .execute<T>(s)
    .then((r) => r.rows);

export type HeatmapPaginaRij = {
  paginaKey: string;
  titel: string;
  kliks: number;
  doden: number;
  woede: number;
  weergaven: number;
  medianeScroll: number;
};

/**
 * Overzicht per pagina — de lijst waar de portal mee opent. Het aandeel dode
 * kliks is hier het interessante getal: dat is de pagina waar bezoekers op iets
 * drukken dat niets doet.
 */
export async function heatmapOverzicht(dagen = 30): Promise<{ dagen: number; paginas: HeatmapPaginaRij[] }> {
  const d = Math.min(365, Math.max(1, Math.round(dagen)));

  const [kliks, scroll] = await Promise.all([
    q<{ pagina_key: string; n: number; doden: number; woede: number }>(sql`
      with g as (select (coalesce(max(dag), date '1970-01-01') + 1) gd from heatmap_cellen)
      select pagina_key, sum(n)::int n, sum(doden)::int doden, sum(woede)::int woede
      from (
        select c.pagina_key, c.n, c.doden, c.woede
          from heatmap_cellen c, g
         where c.dag > current_date - ${d}::int and c.dag < g.gd
        union all
        select k.pagina_key, 1,
               case when k.soort = 'dood' then 1 else 0 end,
               case when k.soort = 'woede' then 1 else 0 end
          from ${heatmapKlikken} k, g
         where k.created_at > now() - (${d} || ' days')::interval
           and (k.created_at at time zone 'Europe/Amsterdam')::date >= g.gd
      ) t
      group by 1`),
    q<{ pagina_key: string; bucket: number; weergaven: number }>(sql`
      with g as (select (coalesce(max(dag), date '1970-01-01') + 1) gd from heatmap_scroll_dag)
      select pagina_key, bucket, sum(weergaven)::int weergaven
      from (
        select s.pagina_key, s.bucket, s.weergaven
          from heatmap_scroll_dag s, g
         where s.dag > current_date - ${d}::int and s.dag < g.gd
        union all
        select r.pagina_key, b.bucket, 1
          from ${heatmapScroll} r, g
          cross join lateral generate_series(0, 100, 5) b(bucket)
         where r.created_at > now() - (${d} || ' days')::interval
           and (r.created_at at time zone 'Europe/Amsterdam')::date >= g.gd
           and r.max_pct >= b.bucket
      ) t
      group by 1, 2`),
  ]);

  const perPagina = new Map<string, HeatmapPaginaRij>();
  const rij = (key: string) => {
    let r = perPagina.get(key);
    if (!r) {
      r = { paginaKey: key, titel: titelVoorPagina(key), kliks: 0, doden: 0, woede: 0, weergaven: 0, medianeScroll: 0 };
      perPagina.set(key, r);
    }
    return r;
  };

  for (const k of kliks) {
    const r = rij(k.pagina_key);
    r.kliks = Number(k.n) || 0;
    r.doden = Number(k.doden) || 0;
    r.woede = Number(k.woede) || 0;
  }
  const bucketsPerPagina = new Map<string, Map<number, number>>();
  for (const s of scroll) {
    const m = bucketsPerPagina.get(s.pagina_key) || new Map<number, number>();
    m.set(Number(s.bucket), Number(s.weergaven) || 0);
    bucketsPerPagina.set(s.pagina_key, m);
  }
  for (const [key, m] of bucketsPerPagina) {
    const r = rij(key);
    r.weergaven = m.get(0) || 0;
    r.medianeScroll = medianeUitBuckets(m);
  }

  return {
    dagen: d,
    paginas: [...perPagina.values()].sort((a, b) => b.kliks - a.kliks || b.weergaven - a.weergaven),
  };
}

export type HeatmapDetail = {
  paginaKey: string;
  titel: string;
  apparaat: Apparaat;
  dagen: number;
  /** Rastercellen: cx 0–49 (promille-kolom), cy = pixelrij / 20. */
  cellen: { cx: number; cy: number; n: number; doden: number; woede: number }[];
  /** Waar het meeste op geklikt wordt, met het aandeel dode kliks. */
  elementen: { selector: string; label: string; n: number; doden: number; woede: number }[];
  /** Scrollbereik: per drempel het percentage weergaven dat zo ver kwam. */
  scroll: { bucket: number; weergaven: number; aandeel: number }[];
  weergaven: number;
  medianeScroll: number;
  /** Echte URL's achter dit sjabloon — de viewer rendert de eerste. */
  voorbeeldPaden: { pad: string; n: number }[];
  /** Mediane documenthoogte: hoe hoog de viewer de overlay moet maken. */
  docHoogte: number;
  /** Mediane vensterhoogte: nodig om een scrollpercentage terug te rekenen
   *  naar een positie op de pagina (bij 50% gescrold zie je de onderkant van
   *  het scherm, niet het midden van het document). */
  vensterHoogte: number;
};

export async function heatmapDetail(opts: {
  pagina: string;
  apparaat: Apparaat;
  dagen?: number;
}): Promise<HeatmapDetail> {
  const d = Math.min(365, Math.max(1, Math.round(opts.dagen ?? 30)));
  const p = opts.pagina;
  const a = opts.apparaat;

  const [cellen, elementen, scroll, paden, hoogte] = await Promise.all([
    q<{ cx: number; cy: number; n: number; doden: number; woede: number }>(sql`
      with g as (select (coalesce(max(dag), date '1970-01-01') + 1) gd from heatmap_cellen)
      select cx, cy, sum(n)::int n, sum(doden)::int doden, sum(woede)::int woede
      from (
        select c.cx, c.cy, c.n, c.doden, c.woede
          from heatmap_cellen c, g
         where c.pagina_key = ${p} and c.apparaat = ${a}
           and c.dag > current_date - ${d}::int and c.dag < g.gd
        union all
        select ${CX}, ${CY}, 1,
               case when k.soort = 'dood' then 1 else 0 end,
               case when k.soort = 'woede' then 1 else 0 end
          from ${heatmapKlikken} k, g
         where k.pagina_key = ${p} and k.apparaat = ${a}
           and k.created_at > now() - (${d} || ' days')::interval
           and (k.created_at at time zone 'Europe/Amsterdam')::date >= g.gd
      ) t
      group by 1, 2
      order by n desc
      limit 4000`),
    q<{ selector: string; label: string; n: number; doden: number; woede: number }>(sql`
      with g as (select (coalesce(max(dag), date '1970-01-01') + 1) gd from heatmap_elementen)
      select selector, max(label) label, sum(n)::int n, sum(doden)::int doden, sum(woede)::int woede
      from (
        select e.selector, e.label, e.n, e.doden, e.woede
          from heatmap_elementen e, g
         where e.pagina_key = ${p} and e.apparaat = ${a}
           and e.dag > current_date - ${d}::int and e.dag < g.gd
        union all
        select k.selector, k.label, 1,
               case when k.soort = 'dood' then 1 else 0 end,
               case when k.soort = 'woede' then 1 else 0 end
          from ${heatmapKlikken} k, g
         where k.pagina_key = ${p} and k.apparaat = ${a} and k.selector <> ''
           and k.created_at > now() - (${d} || ' days')::interval
           and (k.created_at at time zone 'Europe/Amsterdam')::date >= g.gd
      ) t
      group by 1
      order by n desc
      limit 40`),
    q<{ bucket: number; weergaven: number }>(sql`
      with g as (select (coalesce(max(dag), date '1970-01-01') + 1) gd from heatmap_scroll_dag)
      select bucket, sum(weergaven)::int weergaven
      from (
        select s.bucket, s.weergaven
          from heatmap_scroll_dag s, g
         where s.pagina_key = ${p} and s.apparaat = ${a}
           and s.dag > current_date - ${d}::int and s.dag < g.gd
        union all
        select b.bucket, 1
          from ${heatmapScroll} r, g
          cross join lateral generate_series(0, 100, 5) b(bucket)
         where r.pagina_key = ${p} and r.apparaat = ${a}
           and r.created_at > now() - (${d} || ' days')::interval
           and (r.created_at at time zone 'Europe/Amsterdam')::date >= g.gd
           and r.max_pct >= b.bucket
      ) t
      group by 1
      order by 1`),
    // Alleen uit het ruwe deel: welke echte URL de viewer moet openen is een
    // vraag van nu, niet van vorig kwartaal.
    q<{ pad: string; n: number }>(sql`
      select pad, count(*)::int n from ${heatmapKlikken}
       where pagina_key = ${p} and pad <> ''
         and created_at > now() - (${d} || ' days')::interval
       group by 1 order by n desc limit 5`),
    q<{ h: number; vh: number }>(sql`
      select coalesce(percentile_disc(0.5) within group (order by doc_hoogte), 0)::int h,
             coalesce(percentile_disc(0.5) within group (order by venster_hoogte), 0)::int vh
        from ${heatmapScroll}
       where pagina_key = ${p} and apparaat = ${a} and doc_hoogte > 0
         and created_at > now() - (${d} || ' days')::interval`),
  ]);

  // De ladder altijd volledig teruggeven, ook de drempels die niemand haalde.
  // De query levert alleen rijen voor drempels die wél gehaald zijn; kwam er
  // niemand voorbij 70%, dan ontbraken 75–100 helemaal en tekende de viewer
  // daaronder géén band — waardoor juist het stuk dat niemand ziet eruitzag
  // alsof iedereen er kwam.
  const gemeten = new Map(scroll.map((s) => [Number(s.bucket), Number(s.weergaven) || 0]));
  const buckets = new Map<number, number>();
  for (let b = 0; b <= 100; b += 5) buckets.set(b, gemeten.get(b) || 0);
  const weergaven = buckets.get(0) || 0;

  return {
    paginaKey: p,
    titel: titelVoorPagina(p),
    apparaat: a,
    dagen: d,
    cellen: cellen.map((c) => ({
      cx: Number(c.cx),
      cy: Number(c.cy),
      n: Number(c.n),
      doden: Number(c.doden),
      woede: Number(c.woede),
    })),
    elementen: elementen.map((e) => ({
      selector: e.selector,
      label: e.label || "",
      n: Number(e.n),
      doden: Number(e.doden),
      woede: Number(e.woede),
    })),
    scroll: [...buckets.keys()]
      .sort((x, z) => x - z)
      .map((b) => ({
        bucket: b,
        weergaven: buckets.get(b) || 0,
        aandeel: weergaven > 0 ? Math.round(((buckets.get(b) || 0) / weergaven) * 100) : 0,
      })),
    weergaven,
    medianeScroll: medianeUitBuckets(buckets),
    voorbeeldPaden: paden.map((r) => ({ pad: r.pad, n: Number(r.n) })),
    docHoogte: Number(hoogte[0]?.h || 0),
    vensterHoogte: Number(hoogte[0]?.vh || 0),
  };
}

/* ────────────────────────────── Samenvatten ────────────────────────────── */

/**
 * Nachtelijke rollup + opruiming.
 *
 * Rolt de laatste drie hele dagen opnieuw op (idempotent, `on conflict do
 * update`): een beacon die om 23:59 vertrok landt soms pas na middernacht, en
 * één dag terugkijken zou die stil kwijtraken. VANDAAG wordt nooit opgerold —
 * dat is precies de dag die de uitleesquery nog uit het ruwe materiaal haalt,
 * en een halve dag samenvatten zou de andere helft onzichtbaar maken.
 */
export async function rolHeatmapOp(): Promise<{
  cellen: number;
  elementen: number;
  scroll: number;
  ruwOpgeruimd: number;
  bewaardagen: number;
}> {
  const { heatmap } = await getSettings();
  // Ondergrens: de rollup kijkt drie dagen terug, dus korter bewaren dan dat
  // zou materiaal weggooien vóór het is samengevat.
  const bewaardagen = Math.min(365, Math.max(7, Math.round(heatmap.bewaardagen) || 45));
  const db = getDb();
  const van = sql`(current_date - 3)`;
  const tot = sql`(current_date - 1)`;

  await db.execute(sql`
    insert into heatmap_cellen (pagina_key, apparaat, dag, cx, cy, n, doden, woede)
    select pagina_key, apparaat, ${NL_DAG} dag, ${CX} cx, ${CY} cy,
           count(*)::int,
           count(*) filter (where soort = 'dood')::int,
           count(*) filter (where soort = 'woede')::int
      from ${heatmapKlikken}
     where ${NL_DAG} between ${van} and ${tot}
     group by 1, 2, 3, 4, 5
    on conflict (pagina_key, apparaat, dag, cx, cy)
    do update set n = excluded.n, doden = excluded.doden, woede = excluded.woede`);

  await db.execute(sql`
    insert into heatmap_elementen (pagina_key, apparaat, dag, selector, label, n, doden, woede)
    select pagina_key, apparaat, ${NL_DAG} dag, selector, max(label),
           count(*)::int,
           count(*) filter (where soort = 'dood')::int,
           count(*) filter (where soort = 'woede')::int
      from ${heatmapKlikken}
     where selector <> '' and ${NL_DAG} between ${van} and ${tot}
     group by 1, 2, 3, 4
    on conflict (pagina_key, apparaat, dag, selector)
    do update set label = excluded.label, n = excluded.n, doden = excluded.doden, woede = excluded.woede`);

  await db.execute(sql`
    insert into heatmap_scroll_dag (pagina_key, apparaat, dag, bucket, weergaven)
    select s.pagina_key, s.apparaat, (s.created_at at time zone 'Europe/Amsterdam')::date dag,
           b.bucket, count(*)::int
      from ${heatmapScroll} s
      cross join lateral generate_series(0, 100, 5) b(bucket)
     where s.max_pct >= b.bucket
       and (s.created_at at time zone 'Europe/Amsterdam')::date between ${van} and ${tot}
     group by 1, 2, 3, 4
    on conflict (pagina_key, apparaat, dag, bucket)
    do update set weergaven = excluded.weergaven`);

  // Ruw materiaal opruimen. Wat hier weg gaat is samengevat; wat overblijft in
  // de dagtotalen bevat geen sessie-id meer en is niet tot een bezoek te
  // herleiden — dat is de hele reden dat die twee lagen bestaan.
  // Eerst tellen, dan wissen: `rowCount` op een DELETE komt bij neon-http niet
  // betrouwbaar terug, en een cron die "0 opgeruimd" meldt terwijl hij een ton
  // aan rijen wist is erger dan geen melding.
  const teWissen = await q<{ n: number }>(sql`
    select (
      (select count(*) from ${heatmapKlikken} where created_at < now() - (${bewaardagen} || ' days')::interval) +
      (select count(*) from ${heatmapScroll}  where created_at < now() - (${bewaardagen} || ' days')::interval)
    )::int n`);

  await db.execute(sql`
    delete from ${heatmapKlikken} where created_at < now() - (${bewaardagen} || ' days')::interval`);
  await db.execute(sql`
    delete from ${heatmapScroll} where created_at < now() - (${bewaardagen} || ' days')::interval`);

  // Dagtotalen ruim bewaren (ruim 13 maanden), zodat vorig seizoen naast dit
  // seizoen te leggen is.
  await db.execute(sql`delete from heatmap_cellen where dag < current_date - 400`);
  await db.execute(sql`delete from heatmap_elementen where dag < current_date - 400`);
  await db.execute(sql`delete from heatmap_scroll_dag where dag < current_date - 400`);

  // Wat er nu daadwerkelijk aan dagtotalen staat voor de opgerolde dagen —
  // gemeten aan de uitkomst, niet aan wat de insert beweerde te doen.
  const gerold = await q<{ cellen: number; elementen: number; scroll: number }>(sql`
    select
      (select count(*) from heatmap_cellen     where dag between ${van} and ${tot})::int cellen,
      (select count(*) from heatmap_elementen  where dag between ${van} and ${tot})::int elementen,
      (select count(*) from heatmap_scroll_dag where dag between ${van} and ${tot})::int scroll`);

  return {
    cellen: Number(gerold[0]?.cellen || 0),
    elementen: Number(gerold[0]?.elementen || 0),
    scroll: Number(gerold[0]?.scroll || 0),
    ruwOpgeruimd: Number(teWissen[0]?.n || 0),
    bewaardagen,
  };
}
