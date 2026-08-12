/**
 * lib/loyalty-report.ts
 *
 * Meten of de spaarpunten-bonussen doen waarvoor ze bedoeld zijn: minder
 * retouren. Drie vragen, in deze volgorde:
 *
 *   1. Adoptie  — hoeveel klanten halen elke bonus, en wat kost dat?
 *   2. Trechter — hoeveel klanten kregen de kans, klikten, en haalden 'm?
 *   3. Effect   — bestellen klanten mét die bonus anders dan klanten zonder?
 *
 * LEES DE DERDE MET ZORG. Dit is een waarneming, geen bewijs. Wie z'n maten
 * invult is toch al een betrokken klant, en die kocht misschien sowieso
 * gerichter — dat heet zelfselectie. Wat de vergelijking wél eerlijk houdt: een
 * order telt alleen mee in de "mét"-groep als de bonus er op dat moment al
 * stónd (`e.created_at <= o.created_at`). Zonder die voorwaarde zou je gedrag
 * van vóór de bonus aan de bonus toeschrijven, en dan meet je niets.
 *
 * Wil je het écht causaal weten, dan moet je randomiseren wat je kúnt
 * randomiseren: niet of iemand z'n profiel invult, maar of we de bonus tónen.
 * Dat is een A/B-test op het bonus-blok, en die staat hier bewust niet in.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getSettings } from "@/lib/settings";
import { ALLE_BONUSSEN, BONUS_KINDS, type BonusKind } from "@/lib/loyalty-bonus";

export type Range = { from: Date; to: Date };

/* Moet gelijk blijven aan REF_TYPE in lib/loyalty-bonus. Bewust hier herhaald
   en niet geëxporteerd uit die module: dit rapport leest historie, en een
   hernoemde refType mag de oude regels niet onzichtbaar maken. */
const REF_TYPE: Record<BonusKind, string> = {
  account: "bonus_account",
  maatadvies: "bonus_maatadvies",
  wallet: "bonus_wallet",
  winkel: "bonus_winkel",
  profiel: "profile_completion",
};

/* Een order telt als "gekocht" bij deze statussen. 'refunded' zit erbij: een
   volledig terugbetaalde order is een aankoop die is teruggekomen, en juist die
   moeten we kunnen tellen. */
const GEKOCHT = sql`o.status in ('paid','shipped','ready_pickup','delivered','refunded')`;

/* Retour = er ligt een retouraanmelding (behalve een geannuleerde) óf de order
   is volledig terugbetaald. Twee mechanismen naast elkaar: het retourportaal
   schrijft in `returns`, een handmatige terugbetaling alleen orders.status. */
const IS_RETOUR = sql`(o.status = 'refunded' or exists (
  select 1 from returns r where r.order_id = o.id and r.status <> 'cancelled'))`;

export type BonusAdoptie = {
  kind: BonusKind;
  /** Wat de bonus nu waard is (0 = uit). */
  points: number;
  /** Klanten die 'm ooit kregen. */
  klanten: number;
  /** Klanten die 'm in deze periode kregen. */
  nieuw: number;
  /** Punten die er in totaal voor zijn uitgekeerd. */
  puntenUitgekeerd: number;
  /** Wat die punten waard zijn tegen de huidige inwisselkoers. */
  waardeCents: number;
};

export type BonusTrechter = {
  kind: BonusKind;
  /** Sessies waarin de openstaande taak in beeld kwam. */
  gezien: number;
  /** Sessies waarin op de knop van die taak geklikt is. */
  geklikt: number;
  /** Klanten die 'm in deze periode ook echt haalden (uit het grootboek). */
  gehaald: number;
};

export type BonusEffect = {
  kind: BonusKind;
  /** "met" = de bonus stond al op het moment van bestellen. */
  met: BonusEffectGroep;
  zonder: BonusEffectGroep;
};
export type BonusEffectGroep = {
  orders: number;
  klanten: number;
  omzetCents: number;
  retourOrders: number;
  /** Aandeel orders dat (deels) terugkwam. */
  retourPct: number;
  gemOrderCents: number;
};

export type BonusReport = {
  van: string;
  tot: string;
  /** De actuele knoppen, zodat de portal cijfers en instelling naast elkaar toont. */
  instellingen: { pointsPerEuro: number; redeemCentsPerPoint: number; bonusPoints: Record<string, number> };
  adoptie: BonusAdoptie[];
  trechter: BonusTrechter[];
  effect: BonusEffect[];
  /** Waarschuwing die met dit rapport mee hoort te reizen. */
  kanttekening: string;
};

const KANTTEKENING =
  "Waarneming, geen bewijs: klanten die een bonus halen zijn doorgaans al betrokken klanten " +
  "(zelfselectie). Orders tellen alleen mee in de 'met'-groep als de bonus op dat moment al " +
  "toegekend was. Voor een causaal antwoord moet je het tónen van de bonus A/B-testen.";

export async function bonusReport(r: Range): Promise<BonusReport> {
  const db = getDb();
  const lc = (await getSettings()).loyaltyConfig;
  const centsPerPoint = Number(lc?.redeemCentsPerPoint) > 0 ? Number(lc.redeemCentsPerPoint) : 5;
  const refs = ALLE_BONUSSEN.map((k) => REF_TYPE[k]);
  const kindVanRef = new Map(ALLE_BONUSSEN.map((k) => [REF_TYPE[k], k]));

  const [adoptieRijen, trechterRijen, effectRijen] = await Promise.all([
    db.execute<{ ref_type: string; klanten: number; nieuw: number; punten: number }>(sql`
      select ref_type,
             count(distinct customer_id)::int klanten,
             count(distinct customer_id) filter (where created_at between ${r.from} and ${r.to})::int nieuw,
             coalesce(sum(points), 0)::int punten
      from loyalty_events
      where ref_type in (${sql.join(refs.map((x) => sql`${x}`), sql`, `)})
      group by ref_type`),

    /* Gezien/geklikt komen uit de anonieme events (per sessie, geen klant-id) en
       "gehaald" uit het grootboek (per klant). Die twee zijn dus niet op dezelfde
       persoon te matchen — het is een verhouding, geen doorstroom per individu.
       Bewust zo: events koppelen aan een klant-id zou van anonieme analytics
       persoonsgegevens maken.
       Let op bij het lezen: `gezien` en `geklikt` tellen alleen bezoekers die
       analytics-toestemming gaven (lib/consent), `gehaald` telt iedereen. De
       trechter oogt daardoor gunstiger dan hij is — vergelijk 'm over de tijd,
       niet als absoluut doorstroompercentage. */
    db.execute<{ kind: string; gezien: number; geklikt: number }>(sql`
      select handle kind,
             count(distinct session_id) filter (where type = 'bonus_shown')::int gezien,
             count(distinct session_id) filter (where type = 'bonus_click')::int geklikt
      from events
      where type in ('bonus_shown','bonus_click') and handle <> ''
        and created_at between ${r.from} and ${r.to}
      group by handle`),

    db.execute<{
      ref_type: string; met: boolean; orders: number; klanten: number; omzet: string; retour: number;
    }>(sql`
      select k.ref_type,
             exists (
               select 1 from loyalty_events e
               where e.customer_id = o.customer_id
                 and e.ref_type = k.ref_type
                 and e.created_at <= o.created_at
             ) met,
             count(*)::int orders,
             count(distinct o.customer_id)::int klanten,
             coalesce(sum(o.total_cents), 0)::bigint omzet,
             count(*) filter (where ${IS_RETOUR})::int retour
      from orders o
      cross join (values ${sql.join(refs.map((x) => sql`(${x}::text)`), sql`, `)}) k(ref_type)
      where o.customer_id is not null
        and ${GEKOCHT}
        and o.created_at between ${r.from} and ${r.to}
      group by 1, 2`),
  ]);

  const adoptieMap = new Map(adoptieRijen.rows.map((x) => [x.ref_type, x]));
  const trechterMap = new Map(trechterRijen.rows.map((x) => [x.kind, x]));

  const groep = (row?: { orders: number; klanten: number; omzet: string; retour: number }): BonusEffectGroep => {
    const orders = Number(row?.orders) || 0;
    const retour = Number(row?.retour) || 0;
    const omzet = Number(row?.omzet) || 0;
    return {
      orders,
      klanten: Number(row?.klanten) || 0,
      omzetCents: omzet,
      retourOrders: retour,
      retourPct: orders > 0 ? Math.round((retour / orders) * 1000) / 10 : 0,
      gemOrderCents: orders > 0 ? Math.round(omzet / orders) : 0,
    };
  };

  return {
    van: r.from.toISOString().slice(0, 10),
    tot: r.to.toISOString().slice(0, 10),
    instellingen: {
      pointsPerEuro: Number(lc?.pointsPerEuro) > 0 ? Number(lc.pointsPerEuro) : 1,
      redeemCentsPerPoint: centsPerPoint,
      bonusPoints: { ...(lc?.bonusPoints as unknown as Record<string, number>) },
    },
    adoptie: ALLE_BONUSSEN.map((kind) => {
      const row = adoptieMap.get(REF_TYPE[kind]);
      const punten = Number(row?.punten) || 0;
      return {
        kind,
        points: puntenVoor(lc?.bonusPoints, kind),
        klanten: Number(row?.klanten) || 0,
        nieuw: Number(row?.nieuw) || 0,
        puntenUitgekeerd: punten,
        waardeCents: punten * centsPerPoint,
      };
    }),
    /* Alleen de TAKEN hebben een trechter. De welkomstbonus krijg je bij het
       aanmaken van je account; daar valt geen "gezien maar niet gedaan" op te
       meten, dus die zou hier altijd een lege regel opleveren. */
    trechter: BONUS_KINDS.map((kind) => ({
      kind,
      gezien: Number(trechterMap.get(kind)?.gezien) || 0,
      geklikt: Number(trechterMap.get(kind)?.geklikt) || 0,
      gehaald: Number(adoptieMap.get(REF_TYPE[kind])?.nieuw) || 0,
    })),
    effect: ALLE_BONUSSEN.map((kind) => {
      const rijen = effectRijen.rows.filter((x) => kindVanRef.get(x.ref_type) === kind);
      return {
        kind,
        met: groep(rijen.find((x) => x.met)),
        zonder: groep(rijen.find((x) => !x.met)),
      };
    }),
    kanttekening: KANTTEKENING,
  };
}

function puntenVoor(bp: unknown, kind: BonusKind): number {
  const b = (bp || {}) as Record<string, unknown>;
  const sleutel =
    kind === "account" ? "accountCreated"
    : kind === "maatadvies" ? "sizeAdvice"
    : kind === "wallet" ? "walletPass"
    : kind === "winkel" ? "favoriteStore"
    : "profileComplete";
  return Math.max(0, Math.round(Number(b[sleutel]) || 0));
}
