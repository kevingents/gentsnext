import { list } from "@vercel/blob";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/**
 * De vijf kassabon-controles, als data in plaats van als console-uitvoer.
 * UITSLUITEND LEZEN — hier wordt nergens geschreven.
 *
 * Twee afnemers delen deze code, zodat de handmatige run en de nachtelijke cron
 * niet uit elkaar kunnen lopen:
 *   scripts/verify-pos-sales.ts   (npm run verify:possales — print het rapport)
 *   app/api/cron/verify-possales  (dagelijks; mailt alleen als er iets is)
 *
 * Waarom dit bewaakt moet worden:
 *  [1]/[2] = de dagstaat. Die leest Neon-first (storegents
 *      lib/pos-closing-store.js:46) en valt alleen terug op de blob als de core
 *      ONBEREIKBAAR is — niet als een bon er simpelweg niet in staat. De
 *      core-write is fire-and-forget (pos-sales-store.js:232) en niemand
 *      controleert het resultaat. Erger: `if (existing) return existing` (regel
 *      226) staat VOOR die core-write, dus een volgende sync van dezelfde bon
 *      vindt 'm in de blob en probeert Neon nooit opnieuw. Een gat heelt nooit
 *      vanzelf, en de kasstaat mist die bon stil.
 *  [5] = geld. De over-retour-guard zit in de blob-mutator en heet daar
 *      "atomisch", maar Vercel Blob heeft geen compare-and-swap: json-blob-store
 *      laat een TOCTOU-venster open en doet na vier pogingen een
 *      last-writer-wins-put. Slaat deze controle aan, dan is er meer
 *      terugbetaald dan er ooit verkocht is.
 */

const KEY = "admin/pos-sales.json";

/** Bonnen jonger dan dit blijven buiten beschouwing: de blob-schrijf en de
 *  core-schrijf gebeuren in dezelfde request, dus een bon die nét langskomt kan
 *  seconden lang "wel blob, nog niet Neon" zijn zonder dat er iets mis is. Een
 *  echt gat is permanent (het heelt nooit vanzelf) en valt de volgende run
 *  alsnog op — een vals alarm zou het kanaal juist onbruikbaar maken. */
export const STANDAARD_GRACE_MINUTEN = 15;

type Bon = {
  id?: string;
  clientRef?: string;
  store?: string;
  kind?: string;
  cancelled?: boolean;
  srsPosted?: boolean;
  srsRef?: string;
  createdAt?: string;
  total?: number;
};

export type OntbrekendeBon = { id: string; store: string; createdAt: string; total: number; cancelled: boolean };
export type GestrandeVoorraad = { ref: string; eerste: string; regels: number };
export type StatusDrift = { id: string; store: string; verschillen: string[] };
export type SoortBotsing = { ref: string; blobId: string; blobKind: string; neonId: string; neonKind: string };
export type OverRetour = { bon: string; sleutel: string; verkocht: number; terug: number; retouren: number };

export type PosSalesVerificatie = {
  graceMinuten: number;
  /** `gelezen: false` → [1], [3] en [4] konden niet draaien (zie `reden`);
   *  [2] en [5] draaien dan gewoon door, die zijn puur Neon. */
  blob: { gelezen: boolean; aantal: number; reden: string };
  neon: { aantal: number; oudste: string; nieuwste: string };
  /** [1] Staat in de blob, niet in Neon. */
  ontbreekt: OntbrekendeBon[];
  /** [2] Voorraad geboekt, geen bon in Neon. `definitiefWeg` is null als de blob
   *  niet gelezen kon worden — dan is niet vast te stellen wie er nog in staat. */
  gestrand: { alle: GestrandeVoorraad[]; definitiefWeg: GestrandeVoorraad[] | null };
  /** [3] Status wijkt af tussen blob en Neon. */
  drift: StatusDrift[];
  /** [4] Zelfde client_ref, andere bon in Neon (verkoop vs retour). */
  botsingen: SoortBotsing[];
  /** [5] Meer geretourneerd dan verkocht. */
  overRetour: OverRetour[];
  /** Context, geen fout: pas met twee retouren op één bon kan de race afvuren. */
  bonnenMetMeerdereRetouren: number;
  /** Gezondheid: de unieke index zou dit onmogelijk moeten maken. */
  dubbeleClientRefs: number;
};

function blobToken(): string {
  return process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
}

async function leesBlob(): Promise<{ sales: Bon[]; reden: string }> {
  const t = blobToken();
  if (!t) return { sales: [], reden: "geen blob-token (STOREGENTS_BLOB_READ_WRITE_TOKEN)" };
  try {
    const { blobs } = await list({ prefix: KEY, limit: 1, token: t });
    const b = (blobs || []).find((x) => x.pathname === KEY);
    if (!b) return { sales: [], reden: "geen pos-sales-blob gevonden" };
    const res = await fetch(`${b.url}?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return { sales: [], reden: `blob-fetch faalde (${res.status})` };
    const data = (await res.json()) as { sales?: Bon[] };
    return { sales: Array.isArray(data?.sales) ? data.sales : [], reden: "" };
  } catch (e) {
    return { sales: [], reden: e instanceof Error ? e.message : "blob onbereikbaar" };
  }
}

/**
 * Draait de vijf controles. Werkt ook zónder blob-token: [1], [3] en [4]
 * vergelijken blob met Neon en vallen dan weg, [2] en [5] zijn puur Neon en
 * blijven gewoon draaien. [5] is de belangrijkste (dat is geld), dus een
 * ontbrekend token maakt deze verificatie zwakker maar niet zinloos.
 */
export async function verifyPosSales(
  opts: { graceMinuten?: number } = {},
): Promise<PosSalesVerificatie> {
  const graceMinuten = Math.max(0, Math.round(opts.graceMinuten ?? STANDAARD_GRACE_MINUTEN));
  const db = getDb();
  const { sales: blob, reden } = await leesBlob();
  const blobGelezen = !reden;
  const grens = Date.now() - graceMinuten * 60_000;
  /* Een bon zonder (of met een onleesbare) datum beoordelen we wél: die is niet
     aantoonbaar vers, en stilzwijgend overslaan zou een gat kunnen verbergen. */
  const teVers = (s: Bon) => {
    const t = s.createdAt ? Date.parse(String(s.createdAt)) : NaN;
    return Number.isFinite(t) && t > grens;
  };
  const beoordeelbaar = blob.filter((s) => !teVers(s));
  const blobIds = blob.map((s) => String(s.id || "")).filter(Boolean);

  const [{ n: neonTotaal }] = (
    await db.execute<{ n: number }>(sql`select count(*)::int n from pos_sales`)
  ).rows;
  const [{ oudste, nieuwste }] = (
    await db.execute<{ oudste: string; nieuwste: string }>(
      sql`select min(created_at)::text oudste, max(created_at)::text nieuwste from pos_sales`,
    )
  ).rows;

  /* ── 1. Staat in de blob, niet in Neon ─────────────────────────────────── */
  /* Id's gaan als één jsonb-parameter mee (niet in de query geplakt): het zijn
     waarden uit een blob, dus data — die horen geparametriseerd. */
  const idsJson = JSON.stringify(blobIds);
  const aanwezig = blobGelezen
    ? new Set(
        (
          await db.execute<{ id: string }>(
            sql`select id from pos_sales where id in (select jsonb_array_elements_text(${idsJson}::jsonb))`,
          )
        ).rows.map((r) => r.id),
      )
    : new Set<string>();
  const ontbreekt: OntbrekendeBon[] = blobGelezen
    ? beoordeelbaar
        .filter((s) => s.id && !aanwezig.has(String(s.id)))
        .map((s) => ({
          id: String(s.id),
          store: String(s.store || ""),
          createdAt: String(s.createdAt || ""),
          total: Number(s.total) || 0,
          cancelled: Boolean(s.cancelled),
        }))
    : [];

  /* ── 2. Al uit de cap gevallen én nooit in Neon beland ─────────────────────
     Elke kassaverkoop schrijft een voorraadmutatie met ref = sale.id
     (storegents api/store/pos-sale.js:622). Een annulering gebruikt
     '<id>:cancel' en een retour '<id>:retour', dus het ':'-filter isoleert de
     verkopen. Die tabel wordt niet gecapt en is dus het enige spoor van bonnen
     die de blob al kwijt is.
     VOORBEHOUD: een bon met alleen cadeaubon-, vermaak- of custom-regels boekt
     geen voorraad en is hiermee niet te vinden. */
  const gestrandAlle = (
    await db.execute<{ ref: string; eerste: string; regels: number }>(sql`
      select m.ref, min(m.created_at)::text eerste, count(*)::int regels
      from store_stock_movements m
      where m.channel = 'pos'
        and m.ref is not null and m.ref <> ''
        and m.ref not like '%:%'
        and m.created_at < now() - make_interval(mins => ${graceMinuten})
        and not exists (select 1 from pos_sales s where s.id = m.ref)
      group by m.ref
      order by min(m.created_at)`)
  ).rows;
  const nogInBlob = new Set(blobIds);
  const definitiefWeg = blobGelezen ? gestrandAlle.filter((v) => !nogInBlob.has(v.ref)) : null;

  /* ── 3. Status loopt uiteen ───────────────────────────────────────────────
     srsRef en kind zitten in de data-jsonb, niet als kolom. */
  const inNeon = blobGelezen
    ? (
        await db.execute<{
          id: string;
          cancelled: boolean;
          srs_posted: boolean;
          srs_ref: string | null;
          kind: string | null;
          client_ref: string;
        }>(sql`
          select id, cancelled, srs_posted, data->>'srsRef' srs_ref, data->>'kind' kind, client_ref
          from pos_sales where id in (select jsonb_array_elements_text(${idsJson}::jsonb))`)
      ).rows
    : [];
  const neonPerId = new Map(inNeon.map((r) => [r.id, r]));

  const drift: StatusDrift[] = [];
  for (const s of beoordeelbaar) {
    const n = neonPerId.get(String(s.id || ""));
    if (!n) continue;
    const verschillen: string[] = [];
    if (Boolean(s.cancelled) !== Boolean(n.cancelled)) verschillen.push(`cancelled blob=${Boolean(s.cancelled)} neon=${Boolean(n.cancelled)}`);
    if (Boolean(s.srsPosted) !== Boolean(n.srs_posted)) verschillen.push(`srsPosted blob=${Boolean(s.srsPosted)} neon=${Boolean(n.srs_posted)}`);
    const bRef = String(s.srsRef || "");
    const nRef = String(n.srs_ref || "");
    if (bRef !== nRef) verschillen.push(`srsRef blob='${bRef}' neon='${nRef}'`);
    if (verschillen.length) drift.push({ id: String(s.id), store: String(s.store || ""), verschillen });
  }

  /* ── 4. Soort-botsing op client_ref ───────────────────────────────────────
     pos_sales_clientref_unique is GLOBAAL uniek op client_ref, terwijl de
     blob-dedup per SOORT werkt (verkoop vs retour). Een retour met dezelfde ref
     als een verkoop wordt in Neon dus stil weggegooid. */
  const refs = beoordeelbaar
    .filter((s) => s.clientRef)
    .map((s) => ({ ref: String(s.clientRef), kind: String(s.kind || "verkoop"), id: String(s.id || "") }));
  /* Apart ophalen OP client_ref: een botsing zit per definitie onder een ANDER
     id, dus de op-id opgehaalde rijen hierboven zouden 'm nooit vinden. */
  const refsJson = JSON.stringify([...new Set(refs.map((r) => r.ref))]);
  const neonPerRef = new Map(
    (blobGelezen
      ? (
          await db.execute<{ client_ref: string; id: string; kind: string | null }>(sql`
            select client_ref, id, data->>'kind' kind
            from pos_sales
            where client_ref <> '' and client_ref in (select jsonb_array_elements_text(${refsJson}::jsonb))`)
        ).rows
      : []
    ).map((r) => [r.client_ref, r] as const),
  );
  const botsingen: SoortBotsing[] = refs
    .filter((r) => {
      const n = neonPerRef.get(r.ref);
      return n && n.id !== r.id;
    })
    .map((r) => {
      const n = neonPerRef.get(r.ref)!;
      return { ref: r.ref, blobId: r.id, blobKind: r.kind, neonId: n.id, neonKind: n.kind || "verkoop" };
    });

  /* ── 5. Is er ooit méér terug gegaan dan er verkocht is? ──────────────────
     Regel-sleutel spiegelt lineKey in storegents lib/pos-sales-store.js
     (sku → barcode → lowercase naam). Cadeaubon-verkoopregels tellen als 0
     verkocht: die zijn niet retourneerbaar.
     De coalesce naar '?' is bewust: zonder die val zou een regel zonder sku,
     barcode én naam een NULL-sleutel krijgen, en NULL = NULL is in SQL niet
     waar — verkoop en retour zouden elkaar dan niet vinden en de retour zou
     hier als vals alarm opduiken. */
  const SLEUTEL = sql`coalesce(nullif(trim(l->>'sku'), ''), nullif(trim(l->>'barcode'), ''), nullif(lower(trim(l->>'name')), ''), '?')`;
  const overRetour = (
    await db.execute<{ bon: string; k: string; verkocht: number; terug: number; n: number }>(sql`
      with verkocht as (
        select s.id as bon, ${SLEUTEL} as k,
               sum(case when coalesce(l->>'lineType', '') = 'giftcard' then 0 else abs((l->>'qty')::numeric) end) as sold
        from pos_sales s, lateral jsonb_array_elements(s.data->'lines') l
        where coalesce(s.data->>'kind', '') <> 'retour'
        group by 1, 2
      ),
      terug as (
        select r.data->>'origSaleId' as bon, ${SLEUTEL} as k,
               sum(abs((l->>'qty')::numeric)) as al, count(distinct r.id)::int as n
        from pos_sales r, lateral jsonb_array_elements(r.data->'lines') l
        where r.data->>'kind' = 'retour' and coalesce(r.data->>'origSaleId', '') <> ''
        group by 1, 2
      )
      select t.bon, t.k, coalesce(v.sold, 0)::int as verkocht, t.al::int as terug, t.n
      from terug t left join verkocht v on v.bon = t.bon and v.k = t.k
      where t.al > coalesce(v.sold, 0)
      order by (t.al - coalesce(v.sold, 0)) desc`)
  ).rows;

  const meerdere = (
    await db.execute<{ n: number }>(
      sql`select count(*)::int n from (
            select 1 from pos_sales where data->>'kind' = 'retour' and coalesce(data->>'origSaleId', '') <> ''
            group by data->>'origSaleId' having count(*) > 1) q`,
    )
  ).rows[0];

  const dubbel = (
    await db.execute<{ client_ref: string; n: number }>(
      sql`select client_ref, count(*)::int n from pos_sales where client_ref <> '' group by 1 having count(*) > 1`,
    )
  ).rows;

  return {
    graceMinuten,
    blob: { gelezen: blobGelezen, aantal: blob.length, reden },
    neon: { aantal: neonTotaal, oudste: oudste || "", nieuwste: nieuwste || "" },
    ontbreekt,
    gestrand: { alle: gestrandAlle, definitiefWeg },
    drift,
    botsingen,
    overRetour: overRetour.map((r) => ({
      bon: r.bon,
      sleutel: String(r.k),
      verkocht: r.verkocht,
      terug: r.terug,
      retouren: r.n,
    })),
    bonnenMetMeerdereRetouren: meerdere?.n ?? 0,
    dubbeleClientRefs: dubbel.length,
  };
}

/**
 * Zonder blob is niet vast te stellen wélke gestrande bonnen nog te redden zijn,
 * dus telt dan de hele stapel. Mét blob telt alleen wat definitief weg is — de
 * rest staat al onder [1].
 */
export function gestrandTeller(v: PosSalesVerificatie): GestrandeVoorraad[] {
  return v.gestrand.definitiefWeg ?? v.gestrand.alle;
}

/** Alles wat niet klopt. 0 = schoon. */
export function totaalAfwijkingen(v: PosSalesVerificatie): number {
  return (
    v.ontbreekt.length + gestrandTeller(v).length + v.drift.length + v.botsingen.length + v.overRetour.length
  );
}

/** De deelverzameling die over GELD gaat: bonnen die de dagstaat mist ([1], [2])
 *  en te veel terugbetaald ([5]). */
export function geldAfwijkingen(v: PosSalesVerificatie): number {
  return v.ontbreekt.length + gestrandTeller(v).length + v.overRetour.length;
}
