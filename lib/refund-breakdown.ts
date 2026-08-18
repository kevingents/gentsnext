/**
 * Refund-rekenkern — bewust PUUR en zonder afhankelijkheden (geen db, geen fetch),
 * zodat zowel de server (lib/returns.ts, lib/support-orderdata.ts) als de client
 * (components/returns/retour-flow.tsx) exact dezelfde bedragen uitrekent. Eerder
 * rekende de klant-preview met de brutosom terwijl de server pro-rata + cadeaubon-
 * split hanteerde — dan belooft het scherm meer dan er wordt uitbetaald.
 *
 * BELANGRIJK: dit is de canonieke formule. De UITVOERING in lib/returns.ts
 * (createReturn → pro-rata, processReturnReceived → cash/credit-split) moet hiermee
 * in de pas blijven; wijzig je de één, wijzig dan de ander. createReturn gebruikt
 * proRataItemsCents al rechtstreeks; processReturnReceived spiegelt refundSplit.
 */

/**
 * Pro-rata waarde van de geretourneerde regels: de brutosom minus het evenredige
 * deel van de orderkorting (voucher/staffel/smoking). Zo krijgt de klant nooit méér
 * terug dan hij voor die artikelen betaalde.
 */
export function proRataItemsCents(itemsGrossCents: number, subtotalCents: number, discountCents: number): number {
  const paidGoods = Math.max(0, subtotalCents - discountCents);
  return subtotalCents > 0 ? Math.round((itemsGrossCents * paidGoods) / subtotalCents) : itemsGrossCents;
}

export type RefundSplitInput = {
  /** Reeds pro-rata berekende itemswaarde (uit proRataItemsCents / ret.itemsCents). */
  itemsCents: number;
  /** Retourkosten die van het CASH-deel afgaan (0 bij gratis of store credit). */
  returnShippingCents: number;
  refundType: "money" | "credit";
  subtotalCents: number;
  discountCents: number;
  /** Met cadeaubon betaald deel van de order (komt als tegoed terug, niet cash). */
  giftcardCents: number;
  /** Originele verzendkosten van de order (telt mee in de cadeaubon-fractie). */
  orderShippingCents: number;
  /** Wat de klant in totaal betaalde; cap op het cash-deel (Mollie kan nooit méér). */
  orderTotalCents: number;
};

export type RefundSplit = {
  /** Terug via de betaalmethode (Mollie). */
  cashCents: number;
  /** Terug als tegoedbon (cadeaubon-deel, of de héle credit-retour). */
  creditCents: number;
  /** Wat de klant in totaal terugkrijgt (cash + tegoed). */
  refundTotalCents: number;
};

/**
 * Splitst een pro-rata itemsbedrag in een cash- en een tegoed-deel. Bij "credit"
 * gaat alles als tegoed (geen retourkosten). Bij "money" komt het cadeaubon-deel
 * als tegoed en de rest cash (minus retourkosten), gecapt op het betaalde totaal.
 * Spiegelt de uitvoering in processReturnReceived (lib/returns.ts).
 */
export function refundSplit(p: RefundSplitInput): RefundSplit {
  if (p.refundType === "credit") {
    return { cashCents: 0, creditCents: p.itemsCents, refundTotalCents: p.itemsCents };
  }
  const paidGoods = Math.max(0, p.subtotalCents - p.discountCents);
  const totalBeforeGiftcard = paidGoods + p.orderShippingCents;
  const giftFraction = totalBeforeGiftcard > 0 ? Math.min(1, p.giftcardCents / totalBeforeGiftcard) : 0;
  const creditCents = Math.round(p.itemsCents * giftFraction);
  const cashCents = Math.min(Math.max(0, p.itemsCents - creditCents - p.returnShippingCents), p.orderTotalCents);
  return { cashCents, creditCents, refundTotalCents: cashCents + creditCents };
}

export type RefundBreakdownInput = Omit<RefundSplitInput, "itemsCents"> & { itemsGrossCents: number };

/**
 * Volledige preview vanaf de BRUTOSOM van de geselecteerde regels: eerst pro-rata,
 * dan de cash/tegoed-split. Voor de klant-preview en de support-widget.
 */
export function refundBreakdown(p: RefundBreakdownInput): RefundSplit & { itemsCents: number } {
  const itemsCents = proRataItemsCents(p.itemsGrossCents, p.subtotalCents, p.discountCents);
  return { itemsCents, ...refundSplit({ ...p, itemsCents }) };
}
