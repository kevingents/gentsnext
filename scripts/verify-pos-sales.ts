import "@/lib/load-env";
import { list } from "@vercel/blob";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/**
 * Telt het verschil tussen de storegents-blob admin/pos-sales.json en de
 * Neon-tabel pos_sales. UITSLUITEND LEZEN — dit script schrijft nergens.
 *   npm run verify:possales
 *
 * Waarom dit moet vóór de blob van het afreken-pad af kan: de dagstaat leest al
 * Neon-first (storegents lib/pos-closing-store.js:46) en valt alleen terug op de
 * blob als de core ONBEREIKBAAR is — niet als een bon er simpelweg niet in staat.
 * De core-write is fire-and-forget (pos-sales-store.js:232) en niemand
 * controleert het resultaat, dus een gemiste rij is onzichtbaar. Erger:
 * `if (existing) return existing` (regel 226) staat VOOR die core-write, dus een
 * volgende sync van dezelfde bon vindt 'm in de blob en probeert Neon nooit
 * opnieuw. Een gat heelt dus nooit vanzelf.
 *
 * Vier getallen. Alle vier horen 0 te zijn.
 */
const KEY = "admin/pos-sales.json";

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

function token(): string {
  return process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
}

function euro(n: unknown): string {
  return `EUR ${(Number(n) || 0).toFixed(2)}`;
}

async function leesBlob(): Promise<Bon[]> {
  const t = token();
  if (!t) {
    console.error("Geen blob-token (STOREGENTS_BLOB_READ_WRITE_TOKEN).");
    process.exit(1);
  }
  const { blobs } = await list({ prefix: KEY, limit: 1, token: t });
  const b = (blobs || []).find((x) => x.pathname === KEY);
  if (!b) {
    console.error("Geen pos-sales-blob gevonden.");
    process.exit(1);
  }
  const res = await fetch(`${b.url}?_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) {
    console.error("Blob-fetch faalde:", res.status);
    process.exit(1);
  }
  const data = (await res.json()) as { sales?: Bon[] };
  return Array.isArray(data?.sales) ? data.sales : [];
}

async function main() {
  const db = getDb();
  const blob = await leesBlob();
  const blobIds = blob.map((s) => String(s.id || "")).filter(Boolean);

  const [{ n: neonTotaal }] = (
    await db.execute<{ n: number }>(sql`select count(*)::int n from pos_sales`)
  ).rows;
  const [{ oudste, nieuwste }] = (
    await db.execute<{ oudste: string; nieuwste: string }>(
      sql`select min(created_at)::text oudste, max(created_at)::text nieuwste from pos_sales`,
    )
  ).rows;

  console.log("=".repeat(78));
  console.log(`blob : ${blob.length} bonnen (cap 5000)`);
  console.log(`neon : ${neonTotaal} bonnen   ${oudste?.slice(0, 10)} t/m ${nieuwste?.slice(0, 10)}`);
  console.log("=".repeat(78));

  /* ── 1. Staat in de blob, niet in Neon ─────────────────────────────────── */
  /* Id's gaan als één jsonb-parameter mee (niet in de query geplakt): het zijn
     waarden uit een blob, dus data — die horen geparametriseerd. */
  const idsJson = JSON.stringify(blobIds);
  const aanwezig = new Set(
    (
      await db.execute<{ id: string }>(
        sql`select id from pos_sales where id in (select jsonb_array_elements_text(${idsJson}::jsonb))`,
      )
    ).rows.map((r) => r.id),
  );
  const ontbreekt = blob.filter((s) => s.id && !aanwezig.has(String(s.id)));

  console.log(`\n[1] In de blob maar NIET in Neon: ${ontbreekt.length}`);
  for (const s of ontbreekt.slice(0, 15)) {
    console.log(
      `      ${String(s.id).padEnd(28)} ${String(s.store || "").padEnd(22)} ${String(s.createdAt || "").slice(0, 16).padEnd(17)} ${euro(s.total)}${s.cancelled ? "  [geannuleerd]" : ""}`,
    );
  }
  if (ontbreekt.length > 15) console.log(`      … en nog ${ontbreekt.length - 15}`);

  /* ── 2. Al uit de cap gevallen én nooit in Neon beland ─────────────────────
     Elke kassaverkoop schrijft een voorraadmutatie met ref = sale.id
     (storegents api/store/pos-sale.js:622). Een annulering gebruikt
     '<id>:cancel' en een retour '<id>:retour', dus het ':'-filter isoleert de
     verkopen. Die tabel wordt niet gecapt en is dus het enige spoor van bonnen
     die de blob al kwijt is.
     VOORBEHOUD: een bon met alleen cadeaubon-, vermaak- of custom-regels boekt
     geen voorraad en is hiermee niet te vinden. */
  const verdwenen = (
    await db.execute<{ ref: string; eerste: string; regels: number }>(sql`
      select m.ref, min(m.created_at)::text eerste, count(*)::int regels
      from store_stock_movements m
      where m.channel = 'pos'
        and m.ref is not null and m.ref <> ''
        and m.ref not like '%:%'
        and not exists (select 1 from pos_sales s where s.id = m.ref)
      group by m.ref
      order by min(m.created_at)`)
  ).rows;
  const nogInBlob = new Set(blobIds);
  const echtWeg = verdwenen.filter((v) => !nogInBlob.has(v.ref));

  console.log(`\n[2] Voorraad geboekt maar GEEN bon in Neon: ${verdwenen.length}`);
  console.log(`      waarvan ook niet meer in de blob (definitief weg): ${echtWeg.length}`);
  for (const v of echtWeg.slice(0, 15)) {
    console.log(`      ${v.ref.padEnd(28)} ${v.eerste.slice(0, 16)}   ${v.regels} regel(s)`);
  }
  if (echtWeg.length > 15) console.log(`      … en nog ${echtWeg.length - 15}`);

  /* ── 3. Status loopt uiteen ───────────────────────────────────────────────
     srsRef en kind zitten in de data-jsonb, niet als kolom. */
  const inNeon = (
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
  ).rows;
  const neonPerId = new Map(inNeon.map((r) => [r.id, r]));

  const drift: string[] = [];
  for (const s of blob) {
    const n = neonPerId.get(String(s.id || ""));
    if (!n) continue;
    const verschillen: string[] = [];
    if (Boolean(s.cancelled) !== Boolean(n.cancelled)) verschillen.push(`cancelled blob=${Boolean(s.cancelled)} neon=${Boolean(n.cancelled)}`);
    if (Boolean(s.srsPosted) !== Boolean(n.srs_posted)) verschillen.push(`srsPosted blob=${Boolean(s.srsPosted)} neon=${Boolean(n.srs_posted)}`);
    const bRef = String(s.srsRef || "");
    const nRef = String(n.srs_ref || "");
    if (bRef !== nRef) verschillen.push(`srsRef blob='${bRef}' neon='${nRef}'`);
    if (verschillen.length) drift.push(`      ${String(s.id).padEnd(28)} ${String(s.store || "").padEnd(22)} ${verschillen.join(" | ")}`);
  }
  console.log(`\n[3] Status wijkt af tussen blob en Neon: ${drift.length}`);
  drift.slice(0, 15).forEach((r) => console.log(r));
  if (drift.length > 15) console.log(`      … en nog ${drift.length - 15}`);

  /* ── 4. Soort-botsing op client_ref ───────────────────────────────────────
     pos_sales_clientref_unique is GLOBAAL uniek op client_ref, terwijl de
     blob-dedup per SOORT werkt (verkoop vs retour). Een retour met dezelfde ref
     als een verkoop wordt in Neon dus stil weggegooid. */
  const refs = blob.filter((s) => s.clientRef).map((s) => ({ ref: String(s.clientRef), kind: String(s.kind || "verkoop"), id: String(s.id || "") }));
  /* Apart ophalen OP client_ref: een botsing zit per definitie onder een ANDER
     id, dus de op-id opgehaalde rijen hierboven zouden 'm nooit vinden. */
  const refsJson = JSON.stringify([...new Set(refs.map((r) => r.ref))]);
  const neonPerRef = new Map(
    (
      await db.execute<{ client_ref: string; id: string; kind: string | null }>(sql`
        select client_ref, id, data->>'kind' kind
        from pos_sales
        where client_ref <> '' and client_ref in (select jsonb_array_elements_text(${refsJson}::jsonb))`)
    ).rows.map((r) => [r.client_ref, r] as const),
  );
  const botsing = refs.filter((r) => {
    const n = neonPerRef.get(r.ref);
    return n && n.id !== r.id;
  });
  console.log(`\n[4] Zelfde client_ref, ANDERE bon in Neon (soort-botsing): ${botsing.length}`);
  for (const b of botsing.slice(0, 15)) {
    const n = neonPerRef.get(b.ref)!;
    console.log(`      ref ${b.ref.padEnd(24)} blob=${b.id} (${b.kind})  neon=${n.id} (${n.kind || "verkoop"})`);
  }

  /* ── 5. Is er ooit méér terug gegaan dan er verkocht is? ──────────────────
     De over-retour-guard zit in de blob-mutator en heet daar "atomisch", maar
     Vercel Blob heeft geen compare-and-swap: json-blob-store laat een
     TOCTOU-venster open en doet na vier pogingen een last-writer-wins-put. Twee
     gelijktijdige retouren op dezelfde bon zouden samen dus meer kunnen
     terugnemen dan er verkocht is.

     Die guard vervangen door een race-vaste variant bleek een fors karwei (zie
     de sessie van 7 aug), en het risico is bij dit volume theoretisch. Daarom
     eerst dit: een detector. Slaat 'ie ooit aan, dan weten we het dezelfde dag
     in plaats van bij de jaarrekening.

     Regel-sleutel spiegelt lineKey in storegents lib/pos-sales-store.js
     (sku → barcode → lowercase naam). Cadeaubon-verkoopregels tellen als 0
     verkocht: die zijn niet retourneerbaar. */
  const SLEUTEL = sql`coalesce(nullif(trim(l->>'sku'), ''), nullif(trim(l->>'barcode'), ''), lower(trim(l->>'name')))`;
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

  console.log(`\n[5] Meer geretourneerd dan verkocht: ${overRetour.length}`);
  for (const r of overRetour.slice(0, 15)) {
    console.log(`      bon ${r.bon.padEnd(26)} ${String(r.k).padEnd(16)} verkocht ${r.verkocht}  terug ${r.terug}  (${r.n} retour(en))`);
  }

  /* Context, geen fout: pas met meerdere retouren op één bon wordt de race die
     de guard moet vangen überhaupt mogelijk. Loopt dit op, dan is het tijd om
     de guard alsnog race-vast te maken. */
  const meerdere = (
    await db.execute<{ n: number }>(
      sql`select count(*)::int n from (
            select 1 from pos_sales where data->>'kind' = 'retour' and coalesce(data->>'origSaleId', '') <> ''
            group by data->>'origSaleId' having count(*) > 1) q`,
    )
  ).rows[0];
  console.log(`      bonnen met meer dan één retour: ${meerdere?.n ?? 0} (context — niet fout)`);

  /* Gezondheidscheck: de unieke index zou dit onmogelijk moeten maken. */
  const dubbel = (
    await db.execute<{ client_ref: string; n: number }>(
      sql`select client_ref, count(*)::int n from pos_sales where client_ref <> '' group by 1 having count(*) > 1`,
    )
  ).rows;
  console.log(`\n[gezondheid] Dubbele client_ref in Neon: ${dubbel.length} (hoort 0 te zijn)`);

  const totaal = ontbreekt.length + echtWeg.length + drift.length + botsing.length + overRetour.length;
  console.log("\n" + "=".repeat(78));
  if (totaal === 0) {
    console.log("SCHOON — blob en Neon lopen gelijk, en er is nergens te veel geretourneerd.");
  } else {
    console.log(`${totaal} afwijking(en) gevonden.`);
    if (ontbreekt.length || echtWeg.length) {
      console.log("Let op: [1] en [2] zijn bonnen die de DAGSTAAT nu al mist (die leest Neon-first).");
    }
    if (overRetour.length) {
      console.log("Let op: [5] is GELD — er is meer terugbetaald dan er verkocht is. Direct uitzoeken.");
    }
  }
  console.log("=".repeat(78));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL:", e);
    process.exit(1);
  });
