/**
 * De vaste pakketprijs van "Smoking compleet" is een belofte over ELKE
 * combinatie binnen een niveau, uitgevoerd als korting op het subtotaal. Dat
 * maakt hem het soort code waar een fout stil geld kost: een groep die te snel
 * compleet heet, een rol die dubbel meetelt, of een korting die blijft staan
 * nadat de klant een onderdeel uit zijn mand haalde.
 *
 * Draaien: node --test test/smoking-pakket.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
/* Bewust uit smoking-korting.ts en niet uit smoking-pakket.ts: dat laatste
   trekt de database en de path-aliassen van Next mee, en dan test je de
   rekenkunde niet meer los. */
import { smokingPakketKorting, SMOKING_GROUP_PREFIX, smokingGroupId } from '../lib/smoking-korting.ts';

/* Klassiek: jas 79,95 + broek 44,95 + hemd 29,95 + strik 9,95 = 164,80.
   Pakketprijs 149,95 → 14,85 korting. Dezelfde cijfers als op gents.nl. */
const PAKKET = { klassiek: 14995, wol: 22995 };
const prijsVan = (id) => PAKKET[id] ?? null;

const groep = 'smoking:klassiek:abc123';

const regel = (rol, priceCents, over = {}) => ({
  groupId: groep,
  roleLabel: rol,
  priceCents,
  quantity: 1,
  ...over,
});

const compleet = () => [
  regel('jas', 7995),
  regel('broek', 4495),
  regel('overhemd', 2995),
  regel('strik', 995),
];

test('een compleet pakket krijgt precies het verschil met de vaste prijs', () => {
  assert.equal(smokingPakketKorting(compleet(), prijsVan), 16480 - 14995);
});

test('een onvolledig pakket krijgt niets', () => {
  /* Dit is de hele beveiliging tegen "korting blijft hangen": haalt de klant
     zijn strik uit de mand, dan is de groep niet compleet en betaalt hij
     gewoon de losse prijzen. */
  const zonderStrik = compleet().filter((r) => r.roleLabel !== 'strik');
  assert.equal(smokingPakketKorting(zonderStrik, prijsVan), 0);
});

test('losse artikelen zonder smoking-groep tellen niet mee', () => {
  const los = [
    { groupId: null, roleLabel: 'jas', priceCents: 7995, quantity: 1 },
    { groupId: 'pak:xyz', roleLabel: 'colbert', priceCents: 12995, quantity: 1 },
  ];
  assert.equal(smokingPakketKorting(los, prijsVan), 0);
});

test('twee smokings in één mand krijgen allebei hun korting', () => {
  const tweede = compleet().map((r) => ({ ...r, groupId: 'smoking:klassiek:def456' }));
  assert.equal(smokingPakketKorting([...compleet(), ...tweede], prijsVan), 2 * (16480 - 14995));
});

test('een tweede niveau in dezelfde mand rekent met zijn eigen pakketprijs', () => {
  const wol = [
    regel('jas', 13500, { groupId: 'smoking:wol:zzz' }),
    regel('broek', 5995, { groupId: 'smoking:wol:zzz' }),
    regel('overhemd', 3995, { groupId: 'smoking:wol:zzz' }),
    regel('strik', 1995, { groupId: 'smoking:wol:zzz' }),
  ];
  assert.equal(smokingPakketKorting(wol, prijsVan), 25485 - 22995);
});

test('een onbekend niveau levert geen korting op in plaats van een gratis pakket', () => {
  const onbekend = compleet().map((r) => ({ ...r, groupId: 'smoking:bestaatniet:x' }));
  assert.equal(smokingPakketKorting(onbekend, prijsVan), 0);
});

test('een groep met een dubbele rol geeft nooit méér korting', () => {
  /* Een gemanipuleerde mand met twee jassen in dezelfde groep mag de som niet
     opblazen; we rekenen met de goedkoopste per rol. */
  const dubbel = [...compleet(), regel('jas', 13500)];
  assert.equal(smokingPakketKorting(dubbel, prijsVan), 16480 - 14995);
});

test('extra\'s in dezelfde groep verhogen de korting niet', () => {
  /* De sjaal en de schoenen gaan tegen hun eigen prijs mee. Zouden ze in de
     som meetellen, dan kreeg de klant ze feitelijk gratis. */
  const metExtras = [...compleet(), regel('extra', 9995), regel('extra', 1495)];
  assert.equal(smokingPakketKorting(metExtras, prijsVan), 16480 - 14995);
});

test('is de losse som al lager dan de pakketprijs, dan geen negatieve korting', () => {
  const afgeprijsd = [regel('jas', 3000), regel('broek', 2000), regel('overhemd', 1000), regel('strik', 500)];
  assert.equal(smokingPakketKorting(afgeprijsd, prijsVan), 0);
});

test('een lege mand is geen fout', () => {
  assert.equal(smokingPakketKorting([], prijsVan), 0);
  assert.equal(smokingPakketKorting([{ priceCents: 1000, quantity: 1 }], prijsVan), 0);
});

test('het groepsvoorvoegsel is wat de kassa herkent', () => {
  assert.equal(SMOKING_GROUP_PREFIX, 'smoking:');
  const fout = compleet().map((r) => ({ ...r, groupId: 'smokings:klassiek:x' }));
  assert.equal(smokingPakketKorting(fout, prijsVan), 0);
});
