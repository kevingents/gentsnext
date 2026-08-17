import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getStores } from "@/lib/stores";

/**
 * Werkt "Mijn winkel(s)"? — de meting bij de functie.
 *
 * Drie vragen, in deze volgorde:
 *  1. ADOPTIE — hoeveel klanten hebben er überhaupt een winkel gekozen? Zonder
 *     dat getal is de rest ruis; de spaarpas leerde dat een functie maandenlang
 *     "af" kan zijn terwijl twee van de 23.478 klanten 'm gebruiken.
 *  2. WAAR kiezen ze 'm? Per plek (productpagina, filter, winkeloverzicht), zodat
 *     we weten wélke knop het werk doet en welke weg kan.
 *  3. WAT LEVERT HET OP? Sessies die op winkelvoorraad filteren tegenover alle
 *     sessies: kopen ze vaker? Dat is géén bewijs van oorzaak (wie op een winkel
 *     filtert is al koopbereid), maar wél het cijfer dat een daling zichtbaar
 *     maakt.
 */

export type MijnWinkelInsights = {
  days: number;
  adoptie: { klantenMetWinkel: number; klantenMeerdereWinkels: number; klantenTotaal: number; perWinkel: { city: string; klanten: number }[] };
  keuzes: { bron: string; aan: number; uit: number }[];
  filter: { sessies: number; sessiesKopers: number; alleSessies: number; alleKopers: number };
};

const sinds = (days: number) => sql`created_at > now() - (${days} || ' days')::interval`;

export async function getMijnWinkelInsights(days = 30): Promise<MijnWinkelInsights> {
  const db = getDb();

  /* Eén rij per klant tellen, maar de winkels ontleden uit de LIJST (favoriteStores)
     met terugval op het oude enkelvoudige veld — anders telt een klant met drie
     winkels alleen bij z'n eerste mee. */
  const adoptieQ = db.execute<{ met: number; meerdere: number; totaal: number }>(sql`
    select
      count(*) filter (where coalesce(preferences->>'favoriteStore', '') <> '')::int as met,
      count(*) filter (
        where jsonb_typeof(preferences->'favoriteStores') = 'array'
          and jsonb_array_length(preferences->'favoriteStores') > 1
      )::int as meerdere,
      count(*)::int as totaal
    from customers
  `);

  const perWinkelQ = db.execute<{ handle: string; n: number }>(sql`
    select handle, count(*)::int as n from (
      select jsonb_array_elements_text(
        case
          when jsonb_typeof(preferences->'favoriteStores') = 'array'
               and jsonb_array_length(preferences->'favoriteStores') > 0
            then preferences->'favoriteStores'
          else jsonb_build_array(preferences->>'favoriteStore')
        end
      ) as handle
      from customers
      where coalesce(preferences->>'favoriteStore', '') <> ''
    ) x
    where handle <> ''
    group by handle order by n desc
  `);

  const keuzesQ = db.execute<{ bron: string; aan: number; uit: number }>(sql`
    select coalesce(nullif(props->>'bron', ''), 'onbekend') as bron,
           count(*) filter (where props->>'aan' = 'true')::int as aan,
           count(*) filter (where props->>'aan' = 'false')::int as uit
    from events
    where type = 'mijn_winkel' and ${sinds(days)}
    group by 1 order by aan desc
  `);

  /* Filter-effect in één query: sessies die op winkelvoorraad filterden en hoeveel
     daarvan kochten, naast dezelfde twee getallen voor álle sessies met een
     productweergave (de eerlijke noemer — een sessie zonder product kan nooit kopen). */
  const filterQ = db.execute<{ sessies: number; sessies_kopers: number; alle: number; alle_kopers: number }>(sql`
    with winkel as (
      select distinct session_id from events
      where type = 'filter' and props->>'facet' = 'winkel'
        and coalesce(props->>'on', 'true') <> 'false'
        and session_id <> '' and ${sinds(days)}
    ), alle as (
      select distinct session_id from events
      where type = 'product_view' and session_id <> '' and ${sinds(days)}
    ), koop as (
      select distinct session_id from events
      where type = 'purchase' and session_id <> '' and ${sinds(days)}
    )
    select
      (select count(*) from winkel)::int as sessies,
      (select count(*) from winkel join koop using (session_id))::int as sessies_kopers,
      (select count(*) from alle)::int as alle,
      (select count(*) from alle join koop using (session_id))::int as alle_kopers
  `);

  const [adoptie, perWinkel, keuzes, filter] = await Promise.all([adoptieQ, perWinkelQ, keuzesQ, filterQ]);

  // pageHandle → stad, zodat de portal geen slugs toont.
  const cityByHandle = new Map(getStores().map((s) => [s.pageHandle, s.city]));
  const a = adoptie.rows[0];
  const f = filter.rows[0];
  return {
    days,
    adoptie: {
      klantenMetWinkel: Number(a?.met) || 0,
      klantenMeerdereWinkels: Number(a?.meerdere) || 0,
      klantenTotaal: Number(a?.totaal) || 0,
      perWinkel: perWinkel.rows.map((r) => ({ city: cityByHandle.get(r.handle) ?? r.handle, klanten: Number(r.n) || 0 })),
    },
    keuzes: keuzes.rows.map((r) => ({ bron: r.bron, aan: Number(r.aan) || 0, uit: Number(r.uit) || 0 })),
    filter: {
      sessies: Number(f?.sessies) || 0,
      sessiesKopers: Number(f?.sessies_kopers) || 0,
      alleSessies: Number(f?.alle) || 0,
      alleKopers: Number(f?.alle_kopers) || 0,
    },
  };
}
