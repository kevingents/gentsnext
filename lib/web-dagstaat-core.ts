import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, giftcards, returns } from "@/db/schema";

/**
 * Webshop-dagstaat voor de Exact-boeking (storegents): wat er op één
 * Amsterdamse dag ONLINE is verkocht en hoe dat betaald is. De tegenhanger van
 * de kassa-dagstaat — samen vullen ze de tussenrekeningen die de Mollie-
 * settlements weer leegvegen.
 *
 * Telt per dag (paid_at in Europe/Amsterdam):
 *  - betaalde orders: omzet (totaal incl. 21% btw), waarvan betaald met een
 *    cadeaubon (dat deel is géén Mollie-geld — de bon is het betaalmiddel);
 *  - verkochte cadeaubonnen (via Mollie betaald, issued): omzet-vrijgesteld —
 *    de btw komt pas bij besteding, dit is een multi-purpose voucher;
 *  - afgeronde geld-terug-retouren als TELLER: die hebben (nog) geen eigen
 *    boekdatum-veld, dus de dagstaat kan ze niet aan een dag toerekenen. Ze
 *    zijn er vandaag niet (0 stuks); zodra ze bestaan hoort daar eerst een
 *    refundedAt-kolom voor te komen — de teller maakt dat gat zichtbaar in
 *    plaats van stil.
 */
export async function getWebDagstaatCore(date: string) {
  const db = getDb();

  const orderRows = await db
    .select({
      totalCents: orders.totalCents,
      giftcardCents: orders.giftcardCents,
    })
    .from(orders)
    .where(sql`${orders.paidAt} is not null and (${orders.paidAt} at time zone 'Europe/Amsterdam')::date = ${date}`);

  const giftcardRows = await db
    .select({ initialCents: giftcards.initialCents })
    .from(giftcards)
    .where(
      sql`${giftcards.molliePaymentId} is not null and ${giftcards.issuedAt} is not null
          and ${giftcards.status} <> 'cancelled'
          and (${giftcards.issuedAt} at time zone 'Europe/Amsterdam')::date = ${date}`
    );

  const refundRows = await db
    .select({ n: sql<number>`count(*)` })
    .from(returns)
    .where(sql`${returns.refundType} = 'money' and ${returns.status} = 'completed' and ${returns.refundedCents} > 0`);

  const ordersTotalCents = orderRows.reduce((t, r) => t + (r.totalCents || 0), 0);
  const giftcardUsedCents = orderRows.reduce((t, r) => t + (r.giftcardCents || 0), 0);
  const giftcardsSoldCents = giftcardRows.reduce((t, r) => t + (r.initialCents || 0), 0);

  return {
    ok: true as const,
    date,
    orders: orderRows.length,
    ordersTotalCents,
    giftcardUsedCents,
    giftcardsSold: giftcardRows.length,
    giftcardsSoldCents,
    // Totaal ooit afgeronde geld-terug-retouren: >0 = er bestaat een geldstroom
    // die de web-dagstaat nog niet kan boeken (geen refunddatum-veld).
    moneyRefundsTotal: Number(refundRows[0]?.n) || 0,
  };
}
