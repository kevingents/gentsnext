/**
 * lib/loyalty-brug.ts
 *
 * Van een KASSA-klantnummer naar een gents.nl-klant, en van daaruit naar het
 * ene spaarpunten-grootboek (`loyalty_events`).
 *
 * HET PROBLEEM DAT DIT OPLOST. De kassa kent twee nummerreeksen door elkaar: een
 * gents.nl-uuid óf een SRS-klantnummer, afhankelijk van in welk bestand de
 * verkoper de klant opzocht. Een bon op een SRS-nummer had geen Neon-klant om
 * aan te hangen, dus die punten belandden in een eigen kassa-grootboek
 * (`loyalty_accounts`). Gevolg: aan dezelfde toonbank spaarde een klant in de
 * ene pot en gaf hij uit uit de andere — inwisselen aan de kassa loopt namelijk
 * al via `redeemPointsForVoucher`, en dat is het account-grootboek.
 *
 * DE BRUG IS HET E-MAILADRES, NIET SRS. Gemeten op 13 aug 2026: 0 van de 48.349
 * klanten heeft een SRS-nummer in Neon, dus daarop wachten heeft geen zin. Maar
 * álle kassabonnen van de losse accounts dragen wél een e-mailadres, en 16 van
 * de 19 matchen daarmee direct op een bestaande klant. Dat adres is dus de sleutel.
 *
 * Wat hier gevonden wordt, leggen we vast in `customer_identities` (kind 'pos'),
 * zodat de volgende bon van dezelfde klant meteen raak is en de identiteitslaag
 * uit de CDP z'n werk doet.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { customerIdentities, customers, loyaltyEvents, posSales } from "@/db/schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schoon = (v: unknown) => String(v == null ? "" : v).trim();

/** Het e-mailadres dat de kassa op de bon zette — twee plekken in de jsonb. */
const BON_EMAIL = sql<string>`lower(trim(coalesce(
  ${posSales.data}->>'customerEmail',
  ${posSales.data}->'customer'->>'email',
  ''
)))`;

export type BrugResultaat = {
  /** De gents.nl-klant, of null als we 'm niet konden thuisbrengen. */
  customerId: string | null;
  /** Hoe we 'm vonden — puur voor logging en het migratierapport. */
  via: "uuid" | "identiteit" | "bon-email" | "geen";
};

/**
 * Zoek de gents.nl-klant bij een kassa-klantnummer.
 *
 * Volgorde is bewust: eerst wat zeker is (het id ís de klant), dan wat we eerder
 * hebben vastgesteld, en pas daarna de afleiding via het e-mailadres op de bon.
 * We maken hier GEEN nieuwe klant aan — dat is een besluit van de aanroeper.
 */
export async function neonKlantVoorKassa(
  kassaId: string,
  opts: { saleId?: string } = {},
): Promise<BrugResultaat> {
  const id = schoon(kassaId);
  if (!id) return { customerId: null, via: "geen" };
  const db = getDb();

  // 1. Het kassa-id ís al een gents.nl-klant.
  if (UUID.test(id)) {
    const [c] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, id)).limit(1);
    if (c) return { customerId: c.id, via: "uuid" };
  }

  // 2. Eerder vastgesteld (of door de CDP gelegd).
  const [ident] = await db
    .select({ customerId: customerIdentities.customerId })
    .from(customerIdentities)
    .where(and(sql`${customerIdentities.kind} in ('pos', 'srs')`, eq(customerIdentities.value, id)))
    .limit(1);
  if (ident) return { customerId: ident.customerId, via: "identiteit" };

  // 3. Via het e-mailadres op de bon. Bij voorkeur de bon die nú afgerekend
  //    wordt; anders de meest recente bon van dit kassanummer.
  const saleId = schoon(opts.saleId);
  const bon = saleId
    ? await db.select({ email: BON_EMAIL }).from(posSales).where(eq(posSales.id, saleId)).limit(1)
    : [];
  const email =
    schoon(bon[0]?.email) ||
    schoon(
      (
        await db
          .select({ email: BON_EMAIL })
          .from(posSales)
          .where(and(eq(posSales.customerId, id), sql`${BON_EMAIL} <> ''`))
          .orderBy(desc(posSales.createdAt))
          .limit(1)
      )[0]?.email,
    );
  if (!email) return { customerId: null, via: "geen" };

  const [klant] = await db.select({ id: customers.id }).from(customers).where(eq(customers.email, email)).limit(1);
  if (!klant) return { customerId: null, via: "geen" };

  // Onthouden, zodat de volgende bon stap 2 al haalt.
  await onthoudKassaNummer(klant.id, id);
  return { customerId: klant.id, via: "bon-email" };
}

/**
 * Leg vast dat dit kassanummer bij deze klant hoort. 'afgeleid', niet 'zeker':
 * we leunen op het e-mailadres dat de kassier intikte, en een typefout mag niet
 * als harde waarheid de doelgroepen in lopen.
 */
export async function onthoudKassaNummer(customerId: string, kassaId: string): Promise<void> {
  const cid = schoon(customerId);
  const id = schoon(kassaId);
  if (!cid || !id || UUID.test(id)) return; // een uuid hoeft niet onthouden te worden
  await getDb()
    .insert(customerIdentities)
    .values({ customerId: cid, kind: "pos", value: id, zekerheid: "afgeleid" })
    .onConflictDoNothing()
    .catch(() => {});
}

/**
 * Boek een mutatie in HET grootboek (`loyalty_events`), idempotent op een sleutel.
 *
 * Anders dan `creditOnce` accepteert dit ook een negatief bedrag: de kassa kan
 * ook afboeken. De sleutel komt van de aanroeper (de kassa gebruikt
 * "<klant>|<bon>|<reden>"), zodat een herhaalde POST van dezelfde bon nooit
 * dubbel telt.
 */
export async function boekInGrootboek(input: {
  customerId: string;
  punten: number;
  reden: string;
  sleutel: string;
  vestsAt?: Date | null;
}): Promise<{ geboekt: boolean; saldo: number }> {
  const cid = schoon(input.customerId);
  const punten = Math.round(Number(input.punten) || 0);
  const sleutel = schoon(input.sleutel);
  if (!cid || !punten || !sleutel) return { geboekt: false, saldo: await grootboekSaldo(cid) };

  const db = getDb();
  const ingevoegd = await db
    .insert(loyaltyEvents)
    .values({
      customerId: cid,
      points: punten,
      reason: schoon(input.reden) || "Kassa",
      refType: "pos_sale",
      refId: sleutel,
      vestsAt: input.vestsAt ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: loyaltyEvents.id });

  if (ingevoegd.length) {
    // Cache atomisch bij; de som van het grootboek blijft de waarheid.
    await db
      .update(customers)
      .set({ loyaltyPoints: sql`greatest(0, ${customers.loyaltyPoints} + ${punten})`, updatedAt: new Date() })
      .where(eq(customers.id, cid));
    try {
      await (await import("@/lib/apple-wallet-push")).pushPassUpdate(cid);
    } catch {
      /* best-effort: de pas verversen mag een verkoop nooit ophouden */
    }
  }
  return { geboekt: ingevoegd.length > 0, saldo: await grootboekSaldo(cid) };
}

/** Totaal in het grootboek (inclusief nog niet besteedbare punten). */
export async function grootboekSaldo(customerId: string): Promise<number> {
  const cid = schoon(customerId);
  if (!cid) return 0;
  const [r] = await getDb()
    .select({ totaal: sql<number>`coalesce(sum(${loyaltyEvents.points}), 0)::int` })
    .from(loyaltyEvents)
    .where(eq(loyaltyEvents.customerId, cid));
  return Math.max(0, Number(r?.totaal) || 0);
}
