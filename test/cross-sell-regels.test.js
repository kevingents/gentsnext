import test from "node:test";
import assert from "node:assert/strict";
import { crossSellDoelen, isFormeel } from "../lib/cross-sell-regels.js";

/* "Maak de look compleet" bood bij LAKSCHOENEN een riem en turquoise sokken aan.
   Een lakschoen draag je op black tie — en bij een smokingbroek hoort geen riem.
   De regels keken alleen naar de hoofdgroep ("Schoenen"); de subgroep en de
   gelegenheid telden niet mee. */

test("lakschoen krijgt black-tie-accessoires, nooit een riem", () => {
  const doelen = crossSellDoelen("Schoenen", "Lakschoenen");
  assert.ok(!doelen.includes("Riemen"), "riem hoort niet bij black tie");
  assert.ok(doelen.includes("Strikken"));
  assert.ok(doelen.includes("Pochet"));
});

test("een gewone schoen mag wél een riem voorstellen", () => {
  assert.ok(crossSellDoelen("Schoenen", "Veterschoen").includes("Riemen"));
  assert.ok(crossSellDoelen("Schoenen", "Loafers").includes("Riemen"));
});

test("smoking-artikelen zijn formeel, ook via het SRS-attribuut", () => {
  assert.equal(isFormeel("Colberts", "Smoking"), true);
  assert.equal(isFormeel("Overhemden", "Rokkostuum"), true);
  assert.equal(isFormeel("Broeken", "", { smoking: "Ja" }), true);
  assert.equal(isFormeel("Schoenen", "Veterschoen"), false);
});

test("de riem valt ook weg als de hoofdgroep-regel hem noemt", () => {
  // Broeken → ["Riemen", ...], maar een smokingbroek heeft bretels.
  const doelen = crossSellDoelen("Broeken", "", { smoking: "Ja" });
  assert.ok(!doelen.includes("Riemen"));
});

test("onbekende categorie valt terug op de standaardregel", () => {
  assert.deepEqual(crossSellDoelen("Onbekend", ""), ["Overhemden", "Stropdassen", "Pochet"]);
});

test("smokingoverhemd stelt een strik voor, geen stropdas", () => {
  const doelen = crossSellDoelen("Overhemden", "Smoking");
  assert.ok(doelen.includes("Strikken"));
  assert.ok(!doelen.includes("Stropdassen"));
});
