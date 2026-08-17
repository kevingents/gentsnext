import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  appointments,
  customerProfiles,
  events,
  newsletterSubscribers,
  posSales,
  reservations,
  reviews,
  supportTickets,
} from "@/db/schema";
import { getProfileData } from "@/lib/account";
import { identiteitenVanKlant } from "@/lib/identity";

/**
 * Het 360-klantprofiel: alles wat we van één persoon weten, op één plek.
 *
 * Waarom dit bestand bestaat. Er waren twee halve 360-beelden die elk iets
 * anders lieten zien en géén van beide compleet was:
 *
 *   - De portal-klantkaart toonde online orders, SRS-winkelhistorie, loyalty en
 *     vouchers — maar niet de KASSABONNEN, niet de tickets, niet de afspraken.
 *   - Het kassa-klantpaneel toonde orders en kassabonnen — maar niet de
 *     loyalty, niet de vouchers, niet de SRS-historie.
 *
 * Een verkoper in de winkel en een medewerker in de portal keken dus letterlijk
 * naar een andere klant. Dit bestand is de enige plek waar het hele beeld wordt
 * samengesteld; beide schermen halen het hiervandaan.
 *
 * ── Waarom gematerialiseerd ──────────────────────────────────────────────
 * Het profiel raakt twaalf tabellen. Voor één klantkaart is dat prima, maar een
 * doelgroep telt over 46.000 klanten en moet in de portal binnen een seconde
 * een aantal tonen. Daarom schrijft `herbouwProfielen()` het platgeslagen
 * resultaat weg in `customer_profiles`, in ÉÉN statement — niet per klant, want
 * 46.000 × 12 queries is geen nachtjob maar een storing.
 *
 * ── De ontdubbeling die niemand had ──────────────────────────────────────
 * Een winkelaankoop bestaat in twee tabellen die elkaar niet kennen:
 * `pos_sales` (onze eigen kassa, gesleuteld op de gents-uuid) en
 * `store_purchases` (de SRS-import, gesleuteld op SRS-nummer/e-mail). Dezelfde
 * bon komt dus twee keer voor zodra de SRS-import de kassaverkoop van vandaag
 * terughaalt. Zonder ontdubbeling telt élke omzet in dit profiel dubbel, en
 * daarmee ook elke doelgroep op besteed bedrag. We ontdubbelen op
 * (klant, dag, bedrag) en geven onze eigen kassabon voorrang — die is rijker.
 * Het is een heuristiek, geen sleutel: twee losse aankopen van exact hetzelfde
 * bedrag op dezelfde dag door dezelfde klant tellen als één. Dat is zeldzaam en
 * veel minder erg dan structureel dubbeltellen.
 */

const AANKOOP_STATUSSEN = ["paid", "shipped", "ready_pickup", "delivered"];

/** Uuid-vorm; pos_sales.customer_id is TEXT en kan van alles bevatten. */
const UUID_PATROON = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

/**
 * Telefoonnummer naar E.164 in SQL. Nederland-eerst; onherkenbaar wordt leeg,
 * want een half genormaliseerd nummer matcht bij Meta en Google nergens en
 * verlaagt alleen je matchpercentage zonder dat je ziet waarom.
 */
/* Het klantveld eerst, anders het nummer van de laatste bestelling. Op de
   klantkaart staat maar bij 1.984 van de 46.253 klanten een telefoonnummer; via
   de orders komen er 12.771 bij. Een nummer is een tweede matchsleutel bij Meta
   en Google Ads naast e-mail, en het is wat een winkel nodig heeft om te bellen
   over een afhaalorder. */
const TELEFOON_BRON = sql`coalesce(nullif(c.phone, ''), nullif(a.order_phone, ''), ml.mobiel, '')`;

const TELEFOON_E164 = sql`
  case
    when ${TELEFOON_BRON} ~ '^\\+[0-9]{8,15}$' then regexp_replace(${TELEFOON_BRON}, '[^0-9+]', '', 'g')
    when regexp_replace(${TELEFOON_BRON}, '\\D', '', 'g') ~ '^0031[0-9]{9,}$' then '+' || substr(regexp_replace(${TELEFOON_BRON}, '\\D', '', 'g'), 3)
    when regexp_replace(${TELEFOON_BRON}, '\\D', '', 'g') ~ '^31[0-9]{9,}$'   then '+' || regexp_replace(${TELEFOON_BRON}, '\\D', '', 'g')
    when regexp_replace(${TELEFOON_BRON}, '\\D', '', 'g') ~ '^0[0-9]{8,}$'    then '+31' || substr(regexp_replace(${TELEFOON_BRON}, '\\D', '', 'g'), 2)
    else ''
  end`;

/** SHA256-hex over een genormaliseerde waarde — het formaat dat Meta en Google Ads eisen. */
const hash = (kolom: ReturnType<typeof sql>) =>
  sql`case when trim(coalesce(${kolom}, '')) = '' then '' else encode(sha256(convert_to(lower(trim(${kolom})), 'UTF8')), 'hex') end`;

/* ── Zelf opgegeven maten en profiel-compleetheid ──────────────────────────────
 *
 * Deze twee regels staan óók in lib/profiel-voorkeuren (sizeProfileComplete en
 * profileChecklist) — dat is waar de klant-UI en de bonus mee rekenen. Hier
 * moeten ze een tweede keer, in SQL: de profielherbouw doet 46k klanten in één
 * statement, en dat gaat niet als je per klant TypeScript wilt draaien.
 *
 * Wijzig je de regel daar, wijzig hem hier mee. Loopt het uit elkaar, dan zegt
 * de doelgroep iets anders dan de klant op z'n eigen accountpagina ziet.
 */

/** Minstens twee van de vier hoofdmaten zelf ingevuld. */
const MAATPROFIEL = sql`(
  (case when coalesce(trim(c.size_profile->>'colbert'),  '') <> '' then 1 else 0 end)
+ (case when coalesce(trim(c.size_profile->>'broek'),    '') <> '' then 1 else 0 end)
+ (case when coalesce(trim(c.size_profile->>'overhemd'), '') <> '' then 1 else 0 end)
+ (case when coalesce(trim(c.size_profile->>'schoen'),   '') <> '' then 1 else 0 end)
) >= 2`;

/** Lengte van een voorkeurslijst, ook als er ooit iets anders dan een array in belandt. */
const lijstLengte = (sleutel: string) => sql`
  case when jsonb_typeof(c.preferences->${sleutel}) = 'array'
       then jsonb_array_length(c.preferences->${sleutel}) else 0 end`;

/** De volledige checklist: naam, telefoon, leeftijd, kleuren, winkel, gelegenheden.
 *  De nieuwsbrief-opt-in zit hier bewust NIET in — zie profileChecklist. */
const PROFIEL_COMPLEET = sql`(
      coalesce(trim(c.first_name), '') <> ''
  and coalesce(trim(c.last_name), '')  <> ''
  and coalesce(trim(c.phone), '')      <> ''
  and (coalesce(trim(c.preferences->>'birthDate'), '') <> '' or coalesce(trim(c.preferences->>'ageRange'), '') <> '')
  and ${lijstLengte("favoriteColors")} > 0
  and coalesce(trim(c.preferences->>'favoriteStore'), '') <> ''
  and ${lijstLengte("occasions")} > 0
)`;

/**
 * Geboortedatum zoals de klant hem zelf opgaf, gevalideerd.
 *
 * Alleen jjjj-mm-dd, niet in de toekomst en niet vóór 1900. De regex staat vóór
 * de cast in een CASE en niet in een WHERE: een WHERE-filter mag Postgres
 * verplaatsen, waarna de query klapt op de eerste onzinwaarde. Een typefout zou
 * anders een felicitatie op de verkeerde dag opleveren, en dat is erger dan
 * geen felicitatie.
 */
const GEBOORTEDATUM = sql`
  case
    when c.preferences->>'birthDate' ~ '^\\d{4}-\\d{2}-\\d{2}$'
     and (c.preferences->>'birthDate')::date <= current_date
     and (c.preferences->>'birthDate')::date >= '1900-01-01'::date
    then (c.preferences->>'birthDate')::date
  end`;

export type HerbouwResultaat = { profielen: number; rfm: number; ms: number };

/**
 * Herbouw de profieltabel. Zonder argument: iedereen (nachtjob). Met een lijst
 * klant-id's: alleen die klanten (bijvoorbeeld direct na een bestelling).
 *
 * Let op de volgorde: eerst de feiten, daarna pas RFM en het segmentlabel. RFM
 * is een RANGSCHIKKING binnen de hele klantenkring, dus die moet altijd over de
 * volledige tabel — zou je hem samen met een deelherbouw doen, dan krijgt een
 * klant een score ten opzichte van de vier andere klanten in het batchje.
 */
export async function herbouwProfielen(alleenKlanten?: string[]): Promise<HerbouwResultaat> {
  const start = Date.now();
  const db = getDb();
  const filter = alleenKlanten?.length
    ? sql`where c.id in (${sql.join(alleenKlanten.map((i) => sql`${i}::uuid`), sql`, `)})`
    : sql``;

  const res = await db.execute(sql`
    with
    -- Alleen daadwerkelijk betaalde online orders tellen als aankoop; 'open' en
    -- 'failed' zijn intenties, geen omzet.
    web as (
      select o.customer_id cid,
             count(*)::int n,
             coalesce(sum(o.total_cents), 0)::int bedrag,
             min(coalesce(o.paid_at, o.created_at)) eerste,
             max(coalesce(o.paid_at, o.created_at)) laatste
      from orders o
      where o.customer_id is not null
        and o.status in (${sql.join(AANKOOP_STATUSSEN.map((s) => sql`${s}`), sql`, `)})
      group by 1
    ),

    -- MATERIALIZED dwingt de uuid-filter af vóór de cast. Zonder dat mag
    -- Postgres de cast naar voren halen en klapt de query op een lege string.
    pos_ok as materialized (
      select p.customer_id::uuid cid, p.created_at moment, p.total_cents, p.store winkel, p.data
      from pos_sales p
      where p.cancelled = false and p.customer_id ~ ${UUID_PATROON}
    ),

    winkel_ruw as (
      select cid, moment, total_cents, winkel, 'a_pos' bron from pos_ok
      union all
      select sp.customer_id, sp.purchased_at, sp.total_cents, sp.store_name, 'b_srs'
      from store_purchases sp where sp.customer_id is not null
    ),
    -- De ontdubbeling: één aankoop per (klant, dag, bedrag). 'a_pos' sorteert
    -- vóór 'b_srs', dus onze eigen kassabon wint van de SRS-kopie.
    winkel as (
      select distinct on (cid, date_trunc('day', moment), total_cents) *
      from winkel_ruw
      order by cid, date_trunc('day', moment), total_cents, bron
    ),
    winkel_agg as (
      select cid, count(*)::int n, coalesce(sum(total_cents), 0)::int bedrag,
             min(moment) eerste, max(moment) laatste
      from winkel group by 1
    ),
    -- Favoriete winkel: waar deze klant het vaakst afrekent. Bij gelijkspel wint
    -- de meest recente, want een verhuizing moet zichtbaar worden.
    winkelvoorkeur as (
      select distinct on (cid) cid, winkel
      from (select cid, winkel, count(*) n, max(moment) laatst from winkel where winkel <> '' group by 1, 2) x
      order by cid, n desc, laatst desc
    ),

    ret as (
      select o.customer_id cid, count(*)::int n, coalesce(sum(r.items_cents), 0)::int bedrag
      from returns r join orders o on o.id = r.order_id
      where o.customer_id is not null and r.status not in ('cancelled', 'rejected')
      group by 1
    ),

    punten as (
      select customer_id cid,
             coalesce(sum(points), 0)::int totaal,
             coalesce(sum(points) filter (where vests_at is null or vests_at <= now()), 0)::int beschikbaar,
             -- Wat kwam er uit de eenmalige actie-bonussen? Zegt of iemand op een
             -- prikkel reageert. Sleutels gelijk aan REF_TYPE in lib/loyalty-bonus.
             coalesce(sum(points) filter (
               where ref_type in ('bonus_account','bonus_maatadvies','bonus_wallet','bonus_winkel','profile_completion')
             ), 0)::int bonus,
             -- Welkomstbonus gehad? Nee = klant van vóór 13 aug 2026. Die groep is
             -- als DOELGROEP interessant; met terugwerkende kracht uitbetalen is
             -- een geldbesluit van ± € 120.000.
             bool_or(ref_type = 'bonus_account') welkom
      from loyalty_events group by 1
    ),
    vouchers_agg as (
      select customer_id cid, count(*)::int n
      from vouchers
      where customer_id is not null and status = 'active'
        and (expires_at is null or expires_at > now())
      group by 1
    ),
    tegoed as (
      select customer_id cid, coalesce(sum(balance_cents), 0)::int cents
      from giftcards where customer_id is not null and balance_cents > 0 group by 1
    ),

    -- Gedrag. Alleen events die aan een klant hangen; anonieme bezoekers horen
    -- hier per definitie niet thuis.
    gedrag as (
      select customer_id cid,
             count(distinct session_id) filter (where created_at > now() - interval '30 days')::int sessies,
             count(*) filter (where type = 'product_view' and created_at > now() - interval '30 days')::int views,
             count(*) filter (where type = 'search' and created_at > now() - interval '30 days')::int zoek,
             max(created_at) laatst,
             max(created_at) filter (where type = 'add_to_cart') laatste_kar,
             max(created_at) filter (where type = 'purchase') laatste_koop
      from events where customer_id is not null group by 1
    ),
    laatst_bekeken as (
      select cid, jsonb_agg(handle order by moment desc) lijst
      from (
        select distinct on (customer_id, handle) customer_id cid, handle, created_at moment
        from events where customer_id is not null and type = 'product_view' and handle <> ''
        order by customer_id, handle, created_at desc
      ) x where moment > now() - interval '180 days'
      group by 1
    ),

    -- Affiniteit uit ONLINE regels.
    --
    -- Twee dingen die hier tegen de intuïtie in gaan, allebei gemeten op de
    -- echte data:
    --
    --  1. KOPPELEN OP SKU, NIET OP HANDLE. De kolom order_lines.product_handle
    --     is de handle uit de Shopify-tijd; na de her-import vanuit SRS matcht
    --     die vrijwel niets meer — 87 van de 60.143 orderregels. Via de
    --     variant-SKU matcht 31.454. Een join op handle ziet er correct uit en
    --     levert stil een leeg profiel op, wat veel erger is dan een fout.
    --  2. DE CATEGORIE ZIT IN attributes, NIET IN product_type. Die kolom bevat
    --     SRS-artikelnummers ("1716", "3454") en is maar bij 891 van de 2.973
    --     producten gevuld. hoofdgroep_omschrijving is de echte categorie
    --     (Overhemden, Pakken, Colberts, …) en staat bij 2.956 producten.
    aff_web as (
      select o.customer_id cid,
             p.vendor merk,
             p.attributes ->> 'hoofdgroep_omschrijving' categorie,
             coalesce(nullif(ol.color, ''), pv.color_family) kleur,
             ol.size maat,
             sum(ol.quantity)::int n
      from order_lines ol
      join orders o on o.id = ol.order_id
      left join product_variants pv on pv.sku = ol.sku and ol.sku <> ''
      left join products p on p.id = pv.product_id
      where o.customer_id is not null
        and o.status in (${sql.join(AANKOOP_STATUSSEN.map((s) => sql`${s}`), sql`, `)})
      group by 1, 2, 3, 4, 5
    ),
    -- Affiniteit uit KASSAregels: die dragen alleen een sku, dus via de variant
    -- naar het product. Zonder deze tak zou het profiel van een klant die
    -- uitsluitend in de winkel koopt volledig leeg blijven — precies de klant
    -- die we met omnichannel wilden bereiken.
    aff_pos as (
      select pk.cid,
             p.vendor merk,
             p.attributes ->> 'hoofdgroep_omschrijving' categorie,
             coalesce(nullif(pv.color_family, ''), l.color) kleur,
             coalesce(nullif(l.size, ''), pv.size) maat,
             sum(greatest(1, coalesce((l.qty)::int, 1)))::int n
      from pos_ok pk
      cross join lateral jsonb_to_recordset(coalesce(pk.data -> 'lines', '[]'::jsonb))
        as l(sku text, size text, color text, qty numeric, title text)
      left join product_variants pv on pv.sku = l.sku and l.sku <> ''
      left join products p on p.id = pv.product_id
      group by 1, 2, 3, 4, 5
    ),
    aff as (select * from aff_web union all select * from aff_pos),
    top_merken as (
      select cid, jsonb_agg(jsonb_build_object('waarde', merk, 'aantal', n) order by n desc) lijst
      from (select cid, merk, sum(n)::int n,
                   row_number() over (partition by cid order by sum(n) desc) rk
            from aff where coalesce(merk, '') <> '' group by 1, 2) x
      where rk <= 5 group by 1
    ),
    top_categorieen as (
      select cid, jsonb_agg(jsonb_build_object('waarde', categorie, 'aantal', n) order by n desc) lijst
      from (select cid, categorie, sum(n)::int n,
                   row_number() over (partition by cid order by sum(n) desc) rk
            from aff where coalesce(categorie, '') <> '' group by 1, 2) x
      where rk <= 5 group by 1
    ),
    top_kleuren as (
      select cid, jsonb_agg(jsonb_build_object('waarde', kleur, 'aantal', n) order by n desc) lijst
      from (select cid, kleur, sum(n)::int n,
                   row_number() over (partition by cid order by sum(n) desc) rk
            from aff where coalesce(kleur, '') <> '' group by 1, 2) x
      where rk <= 5 group by 1
    ),
    -- Maten per categorie: "colbert 52, broek 50". Dat is het veld waarmee een
    -- verkoper direct iets kan, en waarmee een doelgroep "nieuwe colberts in
    -- maat 52" gemaakt kan worden.
    maten as (
      select cid, jsonb_object_agg(coalesce(nullif(categorie, ''), 'overig'), maat) obj
      from (
        select distinct on (cid, categorie) cid, categorie, maat
        from aff where coalesce(maat, '') <> ''
        order by cid, categorie, n desc
      ) x group by 1
    ),

    tickets_agg  as (select lower(trim(email)) k, count(*)::int n from support_tickets where trim(email) <> '' group by 1),
    afspraken_agg as (select lower(trim(email)) k, count(*)::int n from appointments      where trim(email) <> '' group by 1),
    reviews_agg  as (select customer_id cid, count(*)::int n from reviews where customer_id is not null group by 1),
    nieuwsbrief  as (
      select lower(trim(email)) k,
             max(case when channel = 'email' then status end) mail_status,
             bool_or(channel = 'whatsapp' and status = 'subscribed') wa
      from newsletter_subscribers where trim(email) <> '' group by 1
    ),
    wallet as (select distinct serial_number sn from wallet_apple_registrations),

    /* ── Wat de klant ZELF opgaf ──────────────────────────────────────────
     * Geboortedatum, leeftijdsgroep, favoriete kleuren, vaste winkel en
     * gelegenheden staan in customers.preferences en werden tot nu toe alléén
     * gebruikt voor het vinkje "profiel compleet". Verder ging er niets mee,
     * terwijl het scherm belooft dat we er de weergave op afstemmen.
     *
     * De datum wordt hier gevalideerd, niet later: alleen jjjj-mm-dd, niet in de
     * toekomst en niet vóór 1900. Een typefout leidt anders tot een felicitatie
     * op de verkeerde dag, en dat is erger dan geen felicitatie. De regex staat
     * vóór de cast in een CASE — een WHERE-filter mag Postgres verplaatsen,
     * waarna de query klapt op de eerste onzinwaarde.
     */
    /* ── Ordergedrag: hoe koopt deze klant, niet alleen hoeveel ───────────
     * mode() geeft de meest gekozen waarde. Taal, betaalmethode en
     * bezorgvoorkeur zijn geen optelsommen maar voorkeuren — een gemiddelde
     * heeft er geen betekenis.
     */
    ordergedrag as (
      select o.customer_id cid,
             count(*)::int n,
             count(*) filter (where o.discount_cents > 0)::int met_korting,
             bool_or(o.company_name <> '' or o.vat_number <> '') zakelijk,
             mode() within group (order by o.locale) taal,
             mode() within group (order by nullif(o.betaalmethode, '')) betaalmethode,
             mode() within group (order by o.delivery_method) bezorg,
             -- Welke maanden koopt hij? Voedt seizoenscampagnes: wie elk jaar in
             -- mei een pak koopt (trouwseizoen) benader je in april.
             jsonb_agg(distinct extract(month from coalesce(o.paid_at, o.created_at))::int) maanden,
             -- 'imported' = binnengehaald uit Shopify; de eigen checkout zet die
             -- status nooit. Zo blijft zichtbaar hoeveel van het beeld nog uit
             -- de oude winkel komt.
             count(*) filter (where o.fulfillment_status = 'imported')::int shopify_n,
             coalesce(sum(o.total_cents) filter (where o.fulfillment_status = 'imported'), 0)::int shopify_bedrag
      from orders o
      where o.customer_id is not null
        and o.status in (${sql.join(AANKOOP_STATUSSEN.map((s) => sql`${s}`), sql`, `)})
      group by 1
    ),

    /* ── Grote maten ──────────────────────────────────────────────────────
     * Alleen de daadwerkelijk GEKOCHTE maat telt. Twee valkuilen die dit veld
     * bij de eerste meting onbruikbaar maakten (18.816 van de 25.062 kopers):
     *
     *  1. De collectie 'Grote maten' bevat 2.252 van de 2.973 producten. Dat is
     *     géén maat-signaal maar "ook in grote maten leverbaar" — driekwart van
     *     de catalogus. Die weg is er daarom uit; hij vertelde iets over het
     *     ARTIKEL, niet over de klant.
     *  2. Maten als 102 en 106 zijn broeklengtes, geen confectiematen. Numeriek
     *     staan ze boven 58 en dus telde elke normale broek mee. Daarom
     *     uitsluitend TWEEcijferige maten (46–64 is de NL-confectiereeks).
     *
     * De cast staat in een CASE en niet in de WHERE, omdat Postgres een
     * WHERE-filter naar voren mag halen en de query dan klapt op "One" of
     * "XL 43/44".
     */
    grote_maten as (
      select distinct o.customer_id cid
      from order_lines ol
      join orders o on o.id = ol.order_id
      where o.customer_id is not null
        and (
          (case when ol.size ~ '^[0-9]{2}$' then ol.size::int else 0 end) >= 58
          or ol.size ~* '^(xxl|xxxl|3xl|4xl|5xl)'
        )
    ),

    -- Kocht ooit een cadeaubon voor iemand anders. Een cadeaukoper reageert op
    -- heel andere momenten (feestdagen, verjaardagen) dan iemand die voor
    -- zichzelf koopt.
    cadeaukoper as (
      select distinct lower(trim(buyer_email)) k from giftcards where trim(buyer_email) <> ''
    ),

    mail as (
      select lower(email) k, verstuurd, geopend, geklikt, laatst_geopend,
             verjaardag, geslacht, mobiel
      from mail_engagement
    ),

    bol as (
      select customer_id cid, count(*)::int n, coalesce(sum(total_cents), 0)::int bedrag
      from externe_orders where bron = 'bol' and customer_id is not null group by 1
    ),

    -- Retourredenen: het verschil tussen "bestelt drie maten en houdt er één"
    -- en "product viel tegen". Zonder reden is een retour alleen een kostenpost.
    retour_reden as (
      select cid, jsonb_agg(jsonb_build_object('waarde', reden, 'aantal', n) order by n desc) lijst
      from (
        select cid, reden, n, row_number() over (partition by cid order by n desc) rk
        from (
          select o.customer_id cid, r.reason reden, count(*)::int n
          from returns r join orders o on o.id = r.order_id
          where o.customer_id is not null and trim(r.reason) <> ''
          group by 1, 2
          union all
          select er.customer_id, er.reden, count(*)::int
          from externe_retouren er
          where er.customer_id is not null and trim(er.reden) <> ''
          group by 1, 2
        ) y
      ) x where rk <= 3 group by 1
    ),
    /* Adres én telefoon: eerst het opgeslagen adresboek, anders het BEZORGADRES
       van de laatste bestelling.
     *
     * Waarom die terugval er moet zijn: customer_addresses bevat 22 rijen op
     * 46.253 klanten — bij de Shopify-import zijn adressen nooit als adresboek
     * overgenomen, ze zitten alleen op de orders. Zonder deze CTE zou het
     * profiel dus voor 99,95% van de klanten geen postcode kennen. Dat is niet
     * cosmetisch: postcode en land zijn matchsleutels bij Meta en Google Ads
     * (ze verhogen het matchpercentage flink) en zonder plaats is elke
     * geografische doelgroep of winkelanalyse onmogelijk.
     *
     * Via de orders komen 26.659 klanten aan een adres en 12.771 aan een
     * telefoonnummer. Het adresboek wint waar het gevuld is: dat is wat de klant
     * zélf heeft opgegeven en onderhoudt.
     */
    adres_boek as (
      select distinct on (customer_id) customer_id cid, postal_code, city, country
      from customer_addresses order by customer_id, is_default desc, created_at desc
    ),
    adres_order as (
      select distinct on (customer_id) customer_id cid, postal_code, city, country, phone
      from orders
      where customer_id is not null and (postal_code <> '' or phone <> '')
      order by customer_id, created_at desc
    ),
    /* Derde bron: de Spotler-export. Die brengt 36.772 postcodes mee, waarvan
       een groot deel bij klanten die nooit online bestelden en dus ook geen
       bezorgadres hebben. Volgorde blijft: eigen adresboek, dan de laatste
       order, dan Spotler — van meest naar minst door de klant zelf onderhouden. */
    adres_spotler as (
      select customer_id cid, postcode, plaats
      from mail_engagement
      where customer_id is not null and (postcode <> '' or plaats <> '')
    ),
    adres as (
      select
        coalesce(b.cid, o.cid, s.cid) cid,
        coalesce(nullif(b.postal_code, ''), nullif(o.postal_code, ''), s.postcode, '') postal_code,
        coalesce(nullif(b.city, ''), nullif(o.city, ''), s.plaats, '') city,
        coalesce(nullif(b.country, ''), o.country, 'NL') country,
        coalesce(o.phone, '') order_phone
      from adres_boek b
      full outer join adres_order o on o.cid = b.cid
      full outer join adres_spotler s on s.cid = coalesce(b.cid, o.cid)
    ),
    -- Attributie van de devices van deze klant: de eerste aanraking die we van
    -- hem kennen. Zo weet je bij een VIP-klant nog steeds welke campagne hem
    -- ooit binnenbracht.
    attributie as (
      select distinct on (ci.customer_id) ci.customer_id cid,
             jsonb_build_object(
               'firstSource', va.first_source, 'firstMedium', va.first_medium,
               'firstCampaign', va.first_campaign, 'lastSource', va.last_source,
               'lastMedium', va.last_medium, 'gclid', va.gclid, 'fbclid', va.fbclid
             ) obj
      from customer_identities ci
      join visitor_attribution va on va.session_id = ci.value
      where ci.kind = 'device'
      order by ci.customer_id, va.first_seen asc
    )

    insert into customer_profiles (
      customer_id, email, email_sha256, phone_e164, phone_sha256,
      voornaam_sha256, achternaam_sha256, postcode, plaats, land, srs_customer_id,
      orders_online, orders_winkel, orders_totaal,
      besteed_online_cents, besteed_winkel_cents, besteed_totaal_cents, gem_orderwaarde_cents,
      eerste_aankoop, laatste_aankoop, dagen_sinds_aankoop, klantwaarde_cents,
      retouren, retour_cents, retourquote,
      punten, punten_beschikbaar, tegoed_cents, actieve_vouchers, wallet_pas,
      bonus_punten, maatprofiel, profiel_compleet, welkomstbonus,
      sessies_30d, productviews_30d, zoekopdrachten_30d, laatst_gezien, kar_verlaten_op, laatst_bekeken,
      tickets, afspraken, reviews,
      top_categorieen, top_merken, top_kleuren, maten, favoriete_winkel, kanaal,
      marketing_opt_in, nieuwsbrief, whatsapp_opt_in, attributie, berekend_op,
      grote_maten, maatprofiel_compleet, kortingsaandeel, orders_met_korting,
      zakelijk, cadeaukoper, taal, betaalmethode, bezorgvoorkeur, aankoopmaanden,
      mail_verstuurd, mail_geopend, mail_geklikt, mail_openratio, mail_laatst_geopend,
      orders_bol, besteed_bol_cents, orders_shopify, besteed_shopify_cents, retour_redenen,
      verjaardag, geboortemaand, geslacht,
      leeftijdsgroep, favoriete_kleuren, gelegenheden, vaste_winkel
    )
    select
      c.id,
      lower(trim(c.email)),
      ${hash(sql`c.email`)},
      ${TELEFOON_E164},
      ${hash(TELEFOON_E164)},
      ${hash(sql`c.first_name`)},
      ${hash(sql`c.last_name`)},
      coalesce(a.postal_code, ''), coalesce(a.city, ''), coalesce(a.country, 'NL'),
      coalesce(c.srs_customer_id, ''),

      coalesce(w.n, 0), coalesce(k.n, 0), coalesce(w.n, 0) + coalesce(k.n, 0),
      coalesce(w.bedrag, 0), coalesce(k.bedrag, 0), coalesce(w.bedrag, 0) + coalesce(k.bedrag, 0),
      case when coalesce(w.n, 0) + coalesce(k.n, 0) > 0
           then ((coalesce(w.bedrag, 0) + coalesce(k.bedrag, 0)) / (coalesce(w.n, 0) + coalesce(k.n, 0)))::int
           else 0 end,
      least(w.eerste, k.eerste),
      greatest(w.laatste, k.laatste),
      case when greatest(w.laatste, k.laatste) is not null
           then extract(day from now() - greatest(w.laatste, k.laatste))::int end,
      -- Ruwe klantwaarde: gemiddelde orderwaarde × aankopen per jaar × 2 jaar
      -- vooruit. Bewust simpel; het doel is sorteren en segmenteren, niet
      -- boekhouden. Een klant die vandaag zijn eerste order plaatste krijgt
      -- geen oneindige waarde omdat we de looptijd op minimaal 90 dagen zetten.
      case when coalesce(w.n, 0) + coalesce(k.n, 0) > 0 then (
        (coalesce(w.bedrag, 0) + coalesce(k.bedrag, 0))::numeric
        / greatest(90, extract(day from now() - least(w.eerste, k.eerste)))
        * 730
      )::int else 0 end,

      coalesce(r.n, 0), coalesce(r.bedrag, 0),
      case when coalesce(w.bedrag, 0) > 0
           then least(100, round(coalesce(r.bedrag, 0)::numeric * 100 / w.bedrag))::int else 0 end,

      coalesce(pt.totaal, 0), coalesce(pt.beschikbaar, 0), coalesce(tg.cents, 0),
      coalesce(v.n, 0), (wl.sn is not null),
      coalesce(pt.bonus, 0), ${MAATPROFIEL}, ${PROFIEL_COMPLEET}, coalesce(pt.welkom, false),

      coalesce(g.sessies, 0), coalesce(g.views, 0), coalesce(g.zoek, 0), g.laatst,
      case when g.laatste_kar > coalesce(g.laatste_koop, 'epoch'::timestamptz) then g.laatste_kar end,
      coalesce(lb.lijst, '[]'::jsonb),

      coalesce(tk.n, 0), coalesce(af.n, 0), coalesce(rv.n, 0),

      coalesce(tc.lijst, '[]'::jsonb), coalesce(tm.lijst, '[]'::jsonb), coalesce(tkl.lijst, '[]'::jsonb),
      coalesce(mt.obj, '{}'::jsonb), coalesce(wv.winkel, ''),
      case when coalesce(w.n, 0) > 0 and coalesce(k.n, 0) > 0 then 'omni'
           when coalesce(w.n, 0) > 0 then 'online'
           when coalesce(k.n, 0) > 0 then 'winkel'
           else 'geen' end,

      c.marketing_opt_in,
      coalesce(nb.mail_status, 'geen'),
      coalesce(nb.wa, false),
      coalesce(at.obj, '{}'::jsonb),
      now(),

      (gm.cid is not null),
      -- "Compleet" = minstens drie categorieën bekend. Met één maat kun je nog
      -- niets adviseren; met drie weet je hoe iemand gebouwd is.
      (coalesce(jsonb_array_length(coalesce(jsonb_path_query_array(mt.obj, '$.keyvalue().key'), '[]'::jsonb)), 0) >= 3),
      case when coalesce(og.n, 0) > 0 then round(coalesce(og.met_korting, 0)::numeric * 100 / og.n)::int else 0 end,
      coalesce(og.met_korting, 0),
      coalesce(og.zakelijk, false),
      (ck.k is not null),
      coalesce(og.taal, 'nl'),
      coalesce(og.betaalmethode, ''),
      coalesce(og.bezorg, ''),
      coalesce(og.maanden, '[]'::jsonb),

      coalesce(ml.verstuurd, 0), coalesce(ml.geopend, 0), coalesce(ml.geklikt, 0),
      case when coalesce(ml.verstuurd, 0) > 0 then round(ml.geopend::numeric * 100 / ml.verstuurd)::int else 0 end,
      ml.laatst_geopend,

      coalesce(bl.n, 0), coalesce(bl.bedrag, 0),
      coalesce(og.shopify_n, 0), coalesce(og.shopify_bedrag, 0),
      coalesce(rr.lijst, '[]'::jsonb),

      /* De KLANT is de betere bron dan Spotler: hij vult het zelf in op
         /account en houdt het bij. Spotler is de terugval voor wie het daar wél
         heeft staan en bij ons niet. Een datum in de toekomst of vóór 1900 is
         een typefout en gooien we weg — een felicitatie op de verkeerde dag is
         erger dan geen felicitatie. */
      coalesce(${GEBOORTEDATUM}, ml.verjaardag),
      -- Apart van de datum: een doelgroep "jarig deze maand" filtert op maand,
      -- niet op jaar, en dat moet indexeerbaar zijn.
      case when coalesce(${GEBOORTEDATUM}, ml.verjaardag) is not null
           then extract(month from coalesce(${GEBOORTEDATUM}, ml.verjaardag))::int end,
      coalesce(ml.geslacht, ''),

      coalesce(nullif(trim(c.preferences->>'ageRange'), ''), ''),
      case when jsonb_typeof(c.preferences->'favoriteColors') = 'array'
           then c.preferences->'favoriteColors' else '[]'::jsonb end,
      case when jsonb_typeof(c.preferences->'occasions') = 'array'
           then c.preferences->'occasions' else '[]'::jsonb end,
      coalesce(nullif(trim(c.preferences->>'favoriteStore'), ''), '')
    from customers c
    left join web            w   on w.cid   = c.id
    left join winkel_agg     k   on k.cid   = c.id
    left join winkelvoorkeur wv  on wv.cid  = c.id
    left join ret            r   on r.cid   = c.id
    left join punten         pt  on pt.cid  = c.id
    left join vouchers_agg   v   on v.cid   = c.id
    left join tegoed         tg  on tg.cid  = c.id
    left join gedrag         g   on g.cid   = c.id
    left join laatst_bekeken lb  on lb.cid  = c.id
    left join top_merken     tm  on tm.cid  = c.id
    left join top_categorieen tc on tc.cid  = c.id
    left join top_kleuren    tkl on tkl.cid = c.id
    left join maten          mt  on mt.cid  = c.id
    left join reviews_agg    rv  on rv.cid  = c.id
    left join adres          a   on a.cid   = c.id
    left join attributie     at  on at.cid  = c.id
    left join wallet         wl  on wl.sn   = c.id::text
    left join tickets_agg    tk  on tk.k    = lower(trim(c.email))
    left join afspraken_agg  af  on af.k    = lower(trim(c.email))
    left join nieuwsbrief    nb  on nb.k    = lower(trim(c.email))
    left join ordergedrag    og  on og.cid  = c.id
    left join grote_maten    gm  on gm.cid  = c.id
    left join bol            bl  on bl.cid  = c.id
    left join retour_reden   rr  on rr.cid  = c.id
    left join cadeaukoper    ck  on ck.k    = lower(trim(c.email))
    left join mail           ml  on ml.k    = lower(trim(c.email))
    ${filter}
    on conflict (customer_id) do update set
      email = excluded.email, email_sha256 = excluded.email_sha256,
      phone_e164 = excluded.phone_e164, phone_sha256 = excluded.phone_sha256,
      voornaam_sha256 = excluded.voornaam_sha256, achternaam_sha256 = excluded.achternaam_sha256,
      postcode = excluded.postcode, plaats = excluded.plaats, land = excluded.land,
      srs_customer_id = excluded.srs_customer_id,
      orders_online = excluded.orders_online, orders_winkel = excluded.orders_winkel,
      orders_totaal = excluded.orders_totaal,
      besteed_online_cents = excluded.besteed_online_cents,
      besteed_winkel_cents = excluded.besteed_winkel_cents,
      besteed_totaal_cents = excluded.besteed_totaal_cents,
      gem_orderwaarde_cents = excluded.gem_orderwaarde_cents,
      eerste_aankoop = excluded.eerste_aankoop, laatste_aankoop = excluded.laatste_aankoop,
      dagen_sinds_aankoop = excluded.dagen_sinds_aankoop, klantwaarde_cents = excluded.klantwaarde_cents,
      retouren = excluded.retouren, retour_cents = excluded.retour_cents, retourquote = excluded.retourquote,
      punten = excluded.punten, punten_beschikbaar = excluded.punten_beschikbaar,
      tegoed_cents = excluded.tegoed_cents, actieve_vouchers = excluded.actieve_vouchers,
      wallet_pas = excluded.wallet_pas, bonus_punten = excluded.bonus_punten,
      maatprofiel = excluded.maatprofiel, profiel_compleet = excluded.profiel_compleet,
      welkomstbonus = excluded.welkomstbonus,
      sessies_30d = excluded.sessies_30d, productviews_30d = excluded.productviews_30d,
      zoekopdrachten_30d = excluded.zoekopdrachten_30d, laatst_gezien = excluded.laatst_gezien,
      kar_verlaten_op = excluded.kar_verlaten_op, laatst_bekeken = excluded.laatst_bekeken,
      tickets = excluded.tickets, afspraken = excluded.afspraken, reviews = excluded.reviews,
      top_categorieen = excluded.top_categorieen, top_merken = excluded.top_merken,
      top_kleuren = excluded.top_kleuren, maten = excluded.maten,
      favoriete_winkel = excluded.favoriete_winkel, kanaal = excluded.kanaal,
      marketing_opt_in = excluded.marketing_opt_in, nieuwsbrief = excluded.nieuwsbrief,
      whatsapp_opt_in = excluded.whatsapp_opt_in, attributie = excluded.attributie,
      grote_maten = excluded.grote_maten, maatprofiel_compleet = excluded.maatprofiel_compleet,
      kortingsaandeel = excluded.kortingsaandeel, orders_met_korting = excluded.orders_met_korting,
      zakelijk = excluded.zakelijk, cadeaukoper = excluded.cadeaukoper,
      taal = excluded.taal, betaalmethode = excluded.betaalmethode,
      bezorgvoorkeur = excluded.bezorgvoorkeur, aankoopmaanden = excluded.aankoopmaanden,
      mail_verstuurd = excluded.mail_verstuurd, mail_geopend = excluded.mail_geopend,
      mail_geklikt = excluded.mail_geklikt, mail_openratio = excluded.mail_openratio,
      mail_laatst_geopend = excluded.mail_laatst_geopend,
      orders_bol = excluded.orders_bol, besteed_bol_cents = excluded.besteed_bol_cents,
      orders_shopify = excluded.orders_shopify, besteed_shopify_cents = excluded.besteed_shopify_cents,
      retour_redenen = excluded.retour_redenen,
      -- coalesce, geen overschrijven: een klant die Spotler even niet kent mag
      -- zijn verjaardag niet kwijtraken.
      verjaardag = coalesce(excluded.verjaardag, customer_profiles.verjaardag),
      geboortemaand = coalesce(excluded.geboortemaand, customer_profiles.geboortemaand),
      geslacht = coalesce(nullif(excluded.geslacht, ''), customer_profiles.geslacht),
      leeftijdsgroep = excluded.leeftijdsgroep,
      favoriete_kleuren = excluded.favoriete_kleuren,
      gelegenheden = excluded.gelegenheden,
      vaste_winkel = excluded.vaste_winkel,

      berekend_op = now()
  `);

  const rfm = await herberekenRfm();
  return {
    profielen: Number((res as { rowCount?: number }).rowCount ?? 0),
    rfm,
    ms: Date.now() - start,
  };
}

/**
 * RFM + segmentlabel over de HELE klantenkring.
 *
 * Recency/Frequency/Monetary zijn rangschikkingen, geen absolute waarden: een
 * klant is "recent" ten opzichte van de anderen. Daarom altijd over de volledige
 * tabel, ook bij een deelherbouw — anders krijgt een klant een score ten
 * opzichte van de drie andere klanten in het batchje.
 *
 * Klanten zonder enige aankoop krijgen bewust score 0 en vallen buiten de
 * ntile-verdeling; zij zouden anders de kwintielen van de kopers vertekenen.
 */
export async function herberekenRfm(): Promise<number> {
  const db = getDb();
  const res = await db.execute(sql`
    with scores as (
      select customer_id,
             ntile(5) over (order by laatste_aankoop asc  nulls first) r,
             ntile(5) over (order by orders_totaal asc)                f,
             ntile(5) over (order by besteed_totaal_cents asc)         m
      from customer_profiles where orders_totaal > 0
    )
    update customer_profiles p set
      rfm_r = s.r, rfm_f = s.f, rfm_m = s.m,
      segment = case
        -- Volgorde is bewust: een klant kan aan meerdere regels voldoen en de
        -- eerste die past wint. Verloren en risico staan vóór vip, want een
        -- VIP die twee jaar weg is moet je terugwinnen, niet belonen.
        when p.dagen_sinds_aankoop > 730 then 'verloren'
        when p.dagen_sinds_aankoop > 365 and s.m >= 4 then 'risico'
        when p.dagen_sinds_aankoop > 365 then 'slapend'
        when s.f >= 4 and s.m >= 4 then 'vip'
        when s.f >= 3 then 'trouw'
        when p.orders_totaal = 1 and p.dagen_sinds_aankoop > 90 then 'eenmalig'
        else 'nieuw'
      end
    from scores s where s.customer_id = p.customer_id
  `);
  // Klanten zonder aankoop zitten niet in `scores` — zij zouden de kwintielen
  // van de kopers vertekenen. Hun label hangt aan gedrag: wie deze maand op de
  // site was is een prospect, de rest is (nog) niets.
  await db.execute(sql`
    update customer_profiles set
      rfm_r = 0, rfm_f = 0, rfm_m = 0,
      segment = case when sessies_30d > 0 then 'nieuw' else 'geen' end
    where orders_totaal = 0
  `);
  return Number((res as { rowCount?: number }).rowCount ?? 0);
}

/* ─────────────────────── Het beeld voor één klant ───────────────────────── */

export type Klant360 = Awaited<ReturnType<typeof getKlant360>>;

/**
 * Alles van één klant, voor de klantkaart in de portal en het kassapaneel.
 *
 * Dit is de samenstelling die nergens bestond. `getProfileData` levert wat de
 * accountpagina altijd al toonde (online orders, SRS-winkelhistorie, vouchers,
 * punten, adressen, cadeaubonnen, retouren); daar komt hier bij wat structureel
 * ontbrak: de eigen KASSABONNEN, de klantvragen, de afspraken, de reserveringen,
 * de reviews, de nieuwsbriefstatus, de identiteiten en de gedragstijdlijn.
 *
 * Alles in één ronde parallel, want dit is een schermrender en geen batch.
 */
export async function getKlant360(customerId: string, email = "") {
  const db = getDb();
  const mail = (email || "").trim().toLowerCase();

  const [
    basis,
    profielRij,
    kassabonnen,
    vragen,
    afsprakenLijst,
    reserveringen,
    reviewsLijst,
    nieuwsbrief,
    identiteiten,
    tijdlijn,
  ] = await Promise.all([
    getProfileData(customerId, mail),
    db.select().from(customerProfiles).where(eq(customerProfiles.customerId, customerId)).limit(1),
    db
      .select({
        id: posSales.id, store: posSales.store, cashier: posSales.cashier,
        totalCents: posSales.totalCents, itemCount: posSales.itemCount,
        cancelled: posSales.cancelled, createdAt: posSales.createdAt, data: posSales.data,
      })
      .from(posSales)
      .where(eq(posSales.customerId, customerId))
      .orderBy(desc(posSales.createdAt))
      .limit(50),
    mail
      ? db.select().from(supportTickets).where(eq(supportTickets.email, mail)).orderBy(desc(supportTickets.createdAt)).limit(25)
      : Promise.resolve([]),
    mail
      ? db.select().from(appointments).where(eq(appointments.email, mail)).orderBy(desc(appointments.createdAt)).limit(25)
      : Promise.resolve([]),
    db.select().from(reservations).where(eq(reservations.customerId, customerId)).orderBy(desc(reservations.createdAt)).limit(25),
    db.select().from(reviews).where(eq(reviews.customerId, customerId)).orderBy(desc(reviews.createdAt)).limit(25),
    mail
      ? db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.email, mail))
      : Promise.resolve([]),
    identiteitenVanKlant(customerId),
    db
      .select({
        type: events.type, path: events.path, handle: events.handle,
        query: events.query, valueCents: events.valueCents,
        props: events.props, createdAt: events.createdAt,
      })
      .from(events)
      .where(eq(events.customerId, customerId))
      .orderBy(desc(events.createdAt))
      .limit(60),
  ]);

  return {
    ...basis,
    profiel: profielRij[0] ?? null,
    kassabonnen,
    vragen,
    afspraken: afsprakenLijst,
    reserveringen,
    reviews: reviewsLijst,
    nieuwsbrief,
    identiteiten,
    tijdlijn,
  };
}

/**
 * Eén klantprofiel bijwerken, direct na een gebeurtenis die het beeld verandert
 * (een betaalde bestelling, een gekoppelde kassabon). Bewust dezelfde code als
 * de nachtjob: twee berekeningen van hetzelfde getal lopen gegarandeerd een keer
 * uiteen, en dan is niet meer te zeggen welke klopt.
 */
export async function ververProfiel(customerId: string): Promise<void> {
  if (!customerId) return;
  try {
    await herbouwProfielen([customerId]);
  } catch (e) {
    console.warn("[360] profiel verversen mislukt:", e instanceof Error ? e.message : e);
  }
}

/** Klanten die sinds een moment iets deden — voor een goedkope deelherbouw. */
export async function klantenMetActiviteitSinds(sinds: Date): Promise<string[]> {
  const db = getDb();
  const rows = await db.execute<{ id: string }>(sql`
    select distinct id from (
      select customer_id id from orders where customer_id is not null and updated_at > ${sinds.toISOString()}
      union
      select customer_id::uuid from pos_sales
        where customer_id ~ ${UUID_PATROON} and created_at > ${sinds.toISOString()}
      union
      select customer_id id from events where customer_id is not null and created_at > ${sinds.toISOString()}
      union
      select customer_id id from loyalty_events where created_at > ${sinds.toISOString()}
    ) x
  `);
  return rows.rows.map((r) => r.id);
}
