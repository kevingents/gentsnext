/**
 * De vier soorten verenigingskorting rekenen echt geld van de bon af. De fouten
 * die je hier maakt zijn stil: een groepsgrens die één stuk verschuift, een
 * restcent die verdwijnt, of een cadeau dat de klant twee keer krijgt omdat het
 * artikel in allebei de lijsten staat.
 *
 * Draaien: node --test test/student-korting.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { berekenKorting } from '../lib/student-korting.ts';

const basis = {
  kortingSoort: 'percent',
  kortingPct: 0,
  kortingCent: 0,
  koopAantal: 0,
  gratisAantal: 0,
  herhalen: true,
  producten: [],
  cadeauProducten: [],
};
const som = (a) => a.reduce((s, n) => s + n, 0);

test('percent: alleen over de deelnemende regels', () => {
  const actie = { ...basis, kortingSoort: 'percent', kortingPct: 20, producten: ['PAK'] };
  const r = berekenKorting(actie, [
    { sku: 'PAK', qty: 1, priceCent: 40000 },
    { sku: 'SOK', qty: 2, priceCent: 1000 },
  ]);
  assert.deepEqual(r, [8000, 0]);
});

test('percent: lege productlijst = alles', () => {
  const actie = { ...basis, kortingPct: 10 };
  assert.deepEqual(berekenKorting(actie, [{ sku: 'X', qty: 2, priceCent: 5000 }]), [1000]);
});

test('bedrag: één keer per bon, evenredig verdeeld, som klopt exact', () => {
  const actie = { ...basis, kortingSoort: 'bedrag', kortingCent: 2500 };
  const r = berekenKorting(actie, [
    { sku: 'A', qty: 1, priceCent: 10000 },
    { sku: 'B', qty: 1, priceCent: 5000 },
  ]);
  assert.equal(som(r), 2500);
  assert.deepEqual(r, [1667, 833]);
});

test('bedrag: restcenten verdwijnen niet', () => {
  const actie = { ...basis, kortingSoort: 'bedrag', kortingCent: 1000 };
  const r = berekenKorting(actie, [
    { sku: 'A', qty: 1, priceCent: 3333 },
    { sku: 'B', qty: 1, priceCent: 3333 },
    { sku: 'C', qty: 1, priceCent: 3334 },
  ]);
  assert.equal(som(r), 1000);
});

test('bedrag: nooit meer dan de klant betaalt', () => {
  /* €25 korting op een bon van €15 mag geen geld uitkeren. */
  const actie = { ...basis, kortingSoort: 'bedrag', kortingCent: 2500 };
  const r = berekenKorting(actie, [{ sku: 'A', qty: 1, priceCent: 1500 }]);
  assert.equal(som(r), 1500);
});

test('2+1: het goedkoopste van de drie is gratis', () => {
  const actie = { ...basis, kortingSoort: 'nplusm', koopAantal: 2, gratisAantal: 1 };
  const r = berekenKorting(actie, [
    { sku: 'A', qty: 1, priceCent: 10000 },
    { sku: 'B', qty: 1, priceCent: 6000 },
    { sku: 'C', qty: 1, priceCent: 4000 },
  ]);
  assert.equal(som(r), 4000);
  assert.deepEqual(r, [0, 0, 4000]);
});

test('2+1: twee artikelen leveren nog niets op', () => {
  const actie = { ...basis, kortingSoort: 'nplusm', koopAantal: 2, gratisAantal: 1 };
  assert.equal(som(berekenKorting(actie, [
    { sku: 'A', qty: 1, priceCent: 10000 },
    { sku: 'B', qty: 1, priceCent: 6000 },
  ])), 0);
});

test('2+1 op zes artikelen: herhalen aan = 2 gratis, uit = 1 gratis', () => {
  const regels = [{ sku: 'A', qty: 6, priceCent: 5000 }];
  const aan = { ...basis, kortingSoort: 'nplusm', koopAantal: 2, gratisAantal: 1, herhalen: true };
  const uit = { ...aan, herhalen: false };
  assert.equal(som(berekenKorting(aan, regels)), 10000);
  assert.equal(som(berekenKorting(uit, regels)), 5000);
});

test('2+1: de goedkoopste per groep, niet de goedkoopste van de bon', () => {
  /* Zes stuks, prijzen 60/50/40/30/20/10. Groepen (60,50,40) en (30,20,10):
     gratis is 40 + 10, niet 10 + 20. */
  const actie = { ...basis, kortingSoort: 'nplusm', koopAantal: 2, gratisAantal: 1 };
  const regels = [6000, 5000, 4000, 3000, 2000, 1000].map((p, i) => ({ sku: `A${i}`, qty: 1, priceCent: p }));
  assert.equal(som(berekenKorting(actie, regels)), 5000);
});

test('cadeau: gratis das bij een pak', () => {
  const actie = { ...basis, kortingSoort: 'cadeau', koopAantal: 1, gratisAantal: 1, producten: ['PAK'], cadeauProducten: ['DAS'] };
  const r = berekenKorting(actie, [
    { sku: 'PAK', qty: 1, priceCent: 40000 },
    { sku: 'DAS', qty: 1, priceCent: 3500 },
  ]);
  assert.deepEqual(r, [0, 3500]);
});

test('cadeau: zonder de aankoop geen cadeau', () => {
  const actie = { ...basis, kortingSoort: 'cadeau', koopAantal: 1, gratisAantal: 1, producten: ['PAK'], cadeauProducten: ['DAS'] };
  assert.equal(som(berekenKorting(actie, [{ sku: 'DAS', qty: 1, priceCent: 3500 }])), 0);
});

test('cadeau: de goedkoopste das gaat weg, en maar één', () => {
  const actie = { ...basis, kortingSoort: 'cadeau', koopAantal: 1, gratisAantal: 1, producten: ['PAK'], cadeauProducten: ['DAS', 'STRIK'] };
  const r = berekenKorting(actie, [
    { sku: 'PAK', qty: 1, priceCent: 40000 },
    { sku: 'DAS', qty: 1, priceCent: 3500 },
    { sku: 'STRIK', qty: 1, priceCent: 2000 },
  ]);
  assert.deepEqual(r, [0, 0, 2000]);
});

test('cadeau: een artikel telt niet als aankoop én als cadeau', () => {
  /* Lege productenlijst = alles, dus de das kwalificeert zichzelf zonder deze
     regel — en dan krijgt de klant hem gratis zonder iets te kopen. */
  const actie = { ...basis, kortingSoort: 'cadeau', koopAantal: 1, gratisAantal: 1, cadeauProducten: ['DAS'] };
  assert.equal(som(berekenKorting(actie, [{ sku: 'DAS', qty: 1, priceCent: 3500 }])), 0);
});

test('cadeau: herhalen geeft per drempel opnieuw recht', () => {
  const actie = { ...basis, kortingSoort: 'cadeau', koopAantal: 2, gratisAantal: 1, producten: ['PAK'], cadeauProducten: ['DAS'], herhalen: true };
  const r = berekenKorting(actie, [
    { sku: 'PAK', qty: 4, priceCent: 40000 },
    { sku: 'DAS', qty: 3, priceCent: 3500 },
  ]);
  assert.equal(som(r), 7000); // 4 pakken = 2x recht, 2 dassen gratis
});

test('een actie zonder ingevulde waarden geeft nooit korting', () => {
  for (const soort of ['percent', 'bedrag', 'nplusm', 'cadeau']) {
    const r = berekenKorting({ ...basis, kortingSoort: soort }, [{ sku: 'A', qty: 1, priceCent: 10000 }]);
    assert.equal(som(r), 0, soort);
  }
});
