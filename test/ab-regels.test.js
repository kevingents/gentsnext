import test from "node:test";
import assert from "node:assert/strict";
import { bucketVoor, variantVoorBucket, doetMee, schoonExperimentsDoc } from "../lib/ab-regels.js";

/* De toewijzing bepaalt wie welke variant ziet — fouten hier vertekenen elke
   testuitslag zonder dat iemand het merkt. Vandaar tests op de wiskunde. */

test("zelfde bezoeker + zelfde experiment = altijd dezelfde bucket", () => {
  for (const wie of ["a1b2c3", "visitor-x", ""]) {
    assert.equal(bucketVoor(wie, "hero-test"), bucketVoor(wie, "hero-test"));
  }
});

test("buckets liggen in 0-99 en verdelen redelijk uniform", () => {
  const telling = new Array(10).fill(0);
  for (let i = 0; i < 10000; i++) {
    const b = bucketVoor(`bezoeker-${i}`, "exp");
    assert.ok(b >= 0 && b < 100);
    telling[Math.floor(b / 10)]++;
  }
  // Elke deciel hoort ~1000 te krijgen; ±25% is ruim genoeg om scheefheid te vangen.
  for (const n of telling) assert.ok(n > 750 && n < 1250, `deciel met ${n} van de 10000`);
});

test("verschillende experimenten verdelen onafhankelijk", () => {
  // Wie in experiment 1 in de lage buckets zit, mag niet systematisch ook in
  // experiment 2 laag zitten. Meet de overlap: rond de 50% is onafhankelijk.
  let beide = 0;
  const n = 4000;
  for (let i = 0; i < n; i++) {
    const laag1 = bucketVoor(`v${i}`, "exp-een") < 50;
    const laag2 = bucketVoor(`v${i}`, "exp-twee") < 50;
    if (laag1 === laag2) beide++;
  }
  assert.ok(beide > n * 0.45 && beide < n * 0.55, `overlap ${beide}/${n}`);
});

test("gewichten 90/10 geven ongeveer die verhouding", () => {
  const exp = { varianten: [{ key: "A", gewicht: 90 }, { key: "B", gewicht: 10 }] };
  let b = 0;
  for (let i = 0; i < 10000; i++) {
    if (variantVoorBucket(exp, bucketVoor(`v${i}`, "x")).key === "B") b++;
  }
  assert.ok(b > 700 && b < 1300, `B kreeg ${b} van de 10000`);
});

test("gewichten hoeven niet op 100 uit te komen (3/1 = 75/25)", () => {
  const exp = { varianten: [{ key: "A", gewicht: 3 }, { key: "B", gewicht: 1 }] };
  assert.equal(variantVoorBucket(exp, 0).key, "A");
  assert.equal(variantVoorBucket(exp, 74).key, "A");
  assert.equal(variantVoorBucket(exp, 75).key, "B");
  assert.equal(variantVoorBucket(exp, 99).key, "B");
});

test("targeting: land en regio filteren, onbekend land doet niet mee", () => {
  const exp = { status: "actief", landen: ["NL"], varianten: [] };
  assert.equal(doetMee(exp, "NL", ""), true);
  assert.equal(doetMee(exp, "DE", ""), false);
  assert.equal(doetMee(exp, "", ""), false); // geo onbekend → buiten de test

  const metRegio = { status: "actief", landen: ["NL"], regios: ["NB"], varianten: [] };
  assert.equal(doetMee(metRegio, "NL", "NB"), true);
  assert.equal(doetMee(metRegio, "NL", "ZH"), false);

  assert.equal(doetMee({ status: "concept", varianten: [] }, "NL", ""), false);
  assert.equal(doetMee({ status: "gestopt", varianten: [] }, "NL", ""), false);
});

test("sanering: javascript-URL's en onzin overleven het niet", () => {
  const { experimenten } = schoonExperimentsDoc({
    experimenten: [
      {
        id: "Hero Test!",
        naam: "Hero",
        status: "actief",
        landen: ["nl", "XX!", "Duitsland"],
        varianten: [
          { key: "a", gewicht: 90 },
          {
            key: "b",
            gewicht: 10,
            overrides: {
              hero: { title: "Nieuw", primaryHref: "javascript:alert(1)" },
              announcement: { text: "Balk", linkHref: "https://gents.nl/x" },
            },
          },
        ],
      },
    ],
  });
  assert.equal(experimenten.length, 1);
  const e = experimenten[0];
  assert.equal(e.id, "hero-test");
  assert.deepEqual(e.landen, ["NL"]);
  assert.equal(e.varianten[1].overrides.hero.primaryHref, undefined);
  assert.equal(e.varianten[1].overrides.announcement.linkHref, "https://gents.nl/x");
});

test("sanering: één variant is geen experiment; alle gewichten 0 krijgt een vangnet", () => {
  const { experimenten } = schoonExperimentsDoc({
    experimenten: [
      { id: "half", varianten: [{ key: "A", gewicht: 100 }] },
      { id: "nul", varianten: [{ key: "A", gewicht: 0 }, { key: "B", gewicht: 0 }] },
    ],
  });
  assert.equal(experimenten.length, 1);
  assert.equal(experimenten[0].id, "nul");
  assert.equal(experimenten[0].varianten[0].gewicht, 100);
});
