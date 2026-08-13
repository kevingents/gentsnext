import test from "node:test";
import assert from "node:assert/strict";
import {
  magNieuweBetaallink,
  terugbetaalRuimte,
  schoonRefundBedrag,
  refundSleutel,
  betaallinkSleutel,
  isSynthetischeBetaalref,
  BETAALDE_STATUSSEN,
} from "../lib/order-acties-regels.js";

/* Twee knoppen in het back-office raken direct het geld van een klant: "stuur
   een nieuwe betaallink" en "betaal terug". Beide falen stil als je ze fout
   bouwt — de eerste incasseert dubbel, de tweede stort niets terug terwijl het
   scherm "gelukt" zegt. Vandaar tests op de regels zelf. */

const OPEN_ORDER = { status: "open", totalCents: 12900, giftcardCode: "", giftcardCents: 0 };

test("een openstaande bestelling mag een nieuwe betaallink", () => {
  const r = magNieuweBetaallink(OPEN_ORDER);
  assert.equal(r.ok, true);
  // Niets teruggedraaid → voorraad/voucher hoeven niet opnieuw geclaimd.
  assert.equal(r.herstelNodig, false);
});

test("elke betaalde toestand blokkeert een nieuwe betaallink, niet alleen 'paid'", () => {
  // 'shipped'/'delivered' zijn óók betaald. Een link daarop = twee keer innen.
  for (const status of BETAALDE_STATUSSEN) {
    const r = magNieuweBetaallink({ ...OPEN_ORDER, status });
    assert.equal(r.ok, false, `${status} zou geen link mogen krijgen`);
    assert.match(r.error, /al betaald/i);
  }
  assert.equal(magNieuweBetaallink({ ...OPEN_ORDER, status: "refunded" }).ok, false);
});

test("een mislukte betaling mag opnieuw, mét herstel van de claims", () => {
  for (const status of ["failed", "expired", "canceled"]) {
    const r = magNieuweBetaallink({ ...OPEN_ORDER, status });
    assert.equal(r.ok, true, `${status} moet een tweede kans krijgen`);
    assert.equal(r.herstelNodig, true, `${status}: voorraad + voucher zijn vrijgegeven`);
  }
});

test("een teruggeboekte cadeaubon blokkeert de tweede link", () => {
  // De bon is al teruggegeven aan de klant en kan niet nog eens op DIT
  // ordernummer worden afgeschreven (redeemGiftcard is idempotent per order).
  const r = magNieuweBetaallink({ status: "failed", totalCents: 5000, giftcardCode: "GC-123", giftcardCents: 2500 });
  assert.equal(r.ok, false);
  assert.match(r.error, /cadeaubon/i);
  // Zolang de betaling niet is teruggedraaid staat de bon nog op de order: prima.
  assert.equal(magNieuweBetaallink({ status: "open", totalCents: 5000, giftcardCode: "GC-123", giftcardCents: 2500 }).ok, true);
});

test("een bestelling van € 0 krijgt geen betaallink", () => {
  const r = magNieuweBetaallink({ ...OPEN_ORDER, totalCents: 0 });
  assert.equal(r.ok, false);
  assert.match(r.error, /niets open/i);
});

test("terugbetalen kan alleen bij een échte Mollie-betaling", () => {
  const betaald = { amountCents: 10000, refundedCents: 0, remainingCents: 10000, status: "paid" };
  assert.equal(terugbetaalRuimte({ molliePaymentId: "tr_abc", totalCents: 10000 }, betaald).maxCents, 10000);

  for (const ref of ["gift-1234", "register-1234", "handmatig-1234"]) {
    assert.ok(isSynthetischeBetaalref(ref));
    const r = terugbetaalRuimte({ molliePaymentId: ref, totalCents: 10000 }, betaald);
    assert.equal(r.maxCents, 0, `${ref} loopt niet via Mollie`);
    assert.match(r.reden, /niet via Mollie/i);
  }
  assert.equal(terugbetaalRuimte({ molliePaymentId: "", totalCents: 10000 }, betaald).maxCents, 0);
});

test("het restant komt van Mollie, niet van onze eigen kolommen", () => {
  // Al € 30 terug van € 100: er mag nog € 70 terug — óók al staat het
  // ordertotaal nog gewoon op € 100.
  const r = terugbetaalRuimte(
    { molliePaymentId: "tr_abc", totalCents: 10000 },
    { amountCents: 10000, refundedCents: 3000, remainingCents: 7000, status: "paid" },
  );
  assert.equal(r.maxCents, 7000);

  // Volledig terug → niets meer.
  const leeg = terugbetaalRuimte(
    { molliePaymentId: "tr_abc", totalCents: 10000 },
    { amountCents: 10000, refundedCents: 10000, remainingCents: 0, status: "paid" },
  );
  assert.equal(leeg.maxCents, 0);
  assert.match(leeg.reden, /volledig terugbetaald/i);
});

test("zonder Mollie-gegevens is het antwoord 0, niet 'dan maar het ordertotaal'", () => {
  const r = terugbetaalRuimte({ molliePaymentId: "tr_abc", totalCents: 10000 }, null);
  assert.equal(r.maxCents, 0);
  // Een openstaande/mislukte betaling levert ook niets op.
  assert.equal(terugbetaalRuimte({ molliePaymentId: "tr_abc" }, { amountCents: 10000, status: "failed" }).maxCents, 0);
});

test("ontbreekt amountRemaining, dan rekenen we het zelf uit", () => {
  const r = terugbetaalRuimte(
    { molliePaymentId: "tr_abc" },
    { amountCents: 10000, refundedCents: 2500, remainingCents: null, status: "paid" },
  );
  assert.equal(r.maxCents, 7500);
});

test("een ingetypt bedrag wordt geklemd op het restant", () => {
  assert.equal(schoonRefundBedrag(5000, 7000), 5000);
  assert.equal(schoonRefundBedrag(9999999, 7000), 7000, "nooit meer dan er geïnd is");
  assert.equal(schoonRefundBedrag(-100, 7000), 0);
  assert.equal(schoonRefundBedrag("", 7000), 0, "leeg veld is 0, niet alles");
  assert.equal(schoonRefundBedrag("abc", 7000), 0);
  assert.equal(schoonRefundBedrag(12.7, 7000), 12, "centen zijn hele getallen");
});

test("de idempotency-sleutels blijven binnen Mollie's 40 tekens én onderscheidend", () => {
  const orderId = "9f8e7d6c-5b4a-4321-9876-abcdefabcdef";
  const nu = 1_786_000_000_000;
  const a = refundSleutel(orderId, 2500, nu);
  const b = refundSleutel(orderId, 5000, nu);
  assert.ok(a.length <= 40, `${a} is ${a.length} tekens`);
  assert.notEqual(a, b, "twee bedragen mogen nooit dezelfde sleutel delen");
  // Dubbelklik binnen dezelfde minuut = één terugstorting.
  assert.equal(a, refundSleutel(orderId, 2500, nu + 5_000));
  // Een minuut later mag hetzelfde bedrag wél opnieuw.
  assert.notEqual(a, refundSleutel(orderId, 2500, nu + 61_000));

  const link = betaallinkSleutel(orderId, nu);
  assert.ok(link.length <= 40);
  assert.equal(link, betaallinkSleutel(orderId, nu + 5_000));
  assert.notEqual(link, betaallinkSleutel(orderId, nu + 61_000));
  // Twee verschillende orders krijgen nooit dezelfde sleutel.
  assert.notEqual(link, betaallinkSleutel("11112222-3333-4444-5555-666677778888", nu));
});
