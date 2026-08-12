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
const TELEFOON_BRON = sql`coalesce(nullif(c.phone, ''), a.order_phone, '')`;

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
             coalesce(sum(points) filter (where vests_at is null or vests_at <= now()), 0)::int beschikbaar
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
    adres as (
      select
        coalesce(b.cid, o.cid) cid,
        coalesce(nullif(b.postal_code, ''), o.postal_code, '') postal_code,
        coalesce(nullif(b.city, ''), o.city, '') city,
        coalesce(nullif(b.country, ''), o.country, 'NL') country,
        coalesce(o.phone, '') order_phone
      from adres_boek b
      full outer join adres_order o on o.cid = b.cid
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
      sessies_30d, productviews_30d, zoekopdrachten_30d, laatst_gezien, kar_verlaten_op, laatst_bekeken,
      tickets, afspraken, reviews,
      top_categorieen, top_merken, top_kleuren, maten, favoriete_winkel, kanaal,
      marketing_opt_in, nieuwsbrief, whatsapp_opt_in, attributie, berekend_op
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
      now()
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
      wallet_pas = excluded.wallet_pas,
      sessies_30d = excluded.sessies_30d, productviews_30d = excluded.productviews_30d,
      zoekopdrachten_30d = excluded.zoekopdrachten_30d, laatst_gezien = excluded.laatst_gezien,
      kar_verlaten_op = excluded.kar_verlaten_op, laatst_bekeken = excluded.laatst_bekeken,
      tickets = excluded.tickets, afspraken = excluded.afspraken, reviews = excluded.reviews,
      top_categorieen = excluded.top_categorieen, top_merken = excluded.top_merken,
      top_kleuren = excluded.top_kleuren, maten = excluded.maten,
      favoriete_winkel = excluded.favoriete_winkel, kanaal = excluded.kanaal,
      marketing_opt_in = excluded.marketing_opt_in, nieuwsbrief = excluded.nieuwsbrief,
      whatsapp_opt_in = excluded.whatsapp_opt_in, attributie = excluded.attributie,
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
