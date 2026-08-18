/**
 * De refund-rekenkern is de bron van waarheid voor zowel de klant-preview als de
 * server-uitvoering. Fout hierin = de klant een bedrag beloven dat we niet
 * uitbetalen (of andersom). Deze tests leggen de twee valkuilen vast die de
 * site-brede review vond: pro-rata bij korting, en de cadeaubon-split bij geld terug.
 *
 * Draaien: node --experimental-strip-types --test test/refund-breakdown.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { proRataItemsCents, refundSplit, refundBreakdown } from "../lib/refund-breakdown.ts";

test("pro-rata: zonder korting is het gewoon de brutosom", () => {
  assert.equal(proRataItemsCents(10000, 20000, 0), 10000);
});

test("pro-rata: korting wordt evenredig verrekend", () => {
  // €200 order, €40 korting, €100 aan artikelen retour → €80 (niet €100).
  assert.equal(proRataItemsCents(10000, 20000, 4000), 8000);
});

test("pro-rata: subtotaal 0 valt veilig terug op de brutosom", () => {
  assert.equal(proRataItemsCents(5000, 0, 0), 5000);
});

test("geld terug zonder cadeaubon: cash = items − retourkosten", () => {
  const r = refundSplit({
    itemsCents: 8000, returnShippingCents: 495, refundType: "money",
    subtotalCents: 20000, discountCents: 4000, giftcardCents: 0,
    orderShippingCents: 0, orderTotalCents: 16000,
  });
  assert.deepEqual(r, { cashCents: 7505, creditCents: 0, refundTotalCents: 7505 });
});

test("geld terug MET cadeaubon: cadeaubon-deel komt als tegoed, niet cash", () => {
  // €200 order, €50 met cadeaubon betaald → 25% van de refund is tegoed.
  const r = refundSplit({
    itemsCents: 10000, returnShippingCents: 0, refundType: "money",
    subtotalCents: 20000, discountCents: 0, giftcardCents: 5000,
    orderShippingCents: 0, orderTotalCents: 15000,
  });
  assert.equal(r.creditCents, 2500); // tegoed
  assert.equal(r.cashCents, 7500); // bank — NIET 10000 (dat was de #112-bug)
  assert.equal(r.refundTotalCents, 10000);
});

test("cash wordt gecapt op het betaalde totaal", () => {
  const r = refundSplit({
    itemsCents: 10000, returnShippingCents: 0, refundType: "money",
    subtotalCents: 10000, discountCents: 0, giftcardCents: 0,
    orderShippingCents: 0, orderTotalCents: 6000,
  });
  assert.equal(r.cashCents, 6000);
});

test("store credit: alles als tegoed, geen retourkosten", () => {
  const r = refundSplit({
    itemsCents: 8000, returnShippingCents: 495, refundType: "credit",
    subtotalCents: 20000, discountCents: 4000, giftcardCents: 0,
    orderShippingCents: 0, orderTotalCents: 16000,
  });
  assert.deepEqual(r, { cashCents: 0, creditCents: 8000, refundTotalCents: 8000 });
});

test("refundBreakdown: preview vanaf brutosom = pro-rata + split", () => {
  // De M8-preview: klant retourneert €100 bruto uit een €200-order met €40 korting.
  const bd = refundBreakdown({
    itemsGrossCents: 10000, returnShippingCents: 495, refundType: "money",
    subtotalCents: 20000, discountCents: 4000, giftcardCents: 0,
    orderShippingCents: 0, orderTotalCents: 16000,
  });
  assert.equal(bd.itemsCents, 8000); // pro-rata, niet €100
  assert.equal(bd.refundTotalCents, 7505); // €80 − €4,95 retourkosten
});
