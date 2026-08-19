/**
 * Het type-filter op de PLP komt uit `subgroep`, en die bronwaarde zegt alleen
 * iets BINNEN zijn hoofdgroep: "Zijde" is een stropdas-stof, "Casual" een
 * colbert-of-gilet, "Lange mouw" een overhemd. Op een gemengde listing stond
 * dat door elkaar in één lijst — inclusief interne modelnamen (Riva) en twee
 * woorden voor hetzelfde kledingstuk (Turtleneck naast Coltrui).
 *
 * Deze test legt de poetsregels vast, én de kant die stil kan breken: een
 * gedeelde of geïndexeerde filterlink met de OUDE waarde moet blijven werken,
 * want expandType() is wat de query uiteindelijk in de database zoekt.
 *
 * Draaien: node --test test/facet-taxonomie.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeType, expandType, TYPE_MIN_COUNT } from '../lib/facet-taxonomy.ts';

test('synonymen vallen samen tot één keuze', () => {
  // Turtleneck 19 en Coltrui 17 stonden als twee losse keuzes in dezelfde lijst.
  assert.equal(normalizeType('Turtleneck', 'Truien'), 'Coltrui');
  assert.equal(normalizeType('Coltrui', 'Truien'), 'Coltrui');
  assert.equal(normalizeType('Halfzip knopen', 'Truien'), 'Halfzip');
  assert.equal(normalizeType('Halfzip', 'Truien'), 'Halfzip');
});

test('Engelse bronwaarden worden Nederlands, en sluiting heet overal hetzelfde', () => {
  assert.equal(normalizeType('V-neck', 'Truien'), 'V-hals');
  assert.equal(normalizeType('Rond', 'T-Shirts'), 'Ronde hals');
  // "Full-zip" bij vesten en "Rits" bij polo's zijn dezelfde keuze.
  assert.equal(normalizeType('Full-zip', 'Vesten'), 'Met rits');
  assert.equal(normalizeType('Rits', 'Polo-shirts'), 'Met rits');
  // "Knopen" stond op de verbergen-lijst en sloopte zo het vesten-filter.
  assert.equal(normalizeType('Knopen', 'Vesten'), 'Met knopen');
});

test('materialen horen in het materiaal-filter, niet in het type-filter', () => {
  // Daar vinden ze óók de mixen ("Zijde katoen linnen"); als typewaarde niet.
  assert.equal(normalizeType('Zijde', 'Stropdassen'), null);
  assert.equal(normalizeType('Poly', 'Strikken'), null);
  assert.equal(normalizeType('Katoen', 'Stropdassen'), null);
  assert.equal(normalizeType('Leer', 'Riemen'), null);
  assert.equal(normalizeType('Suede', 'Riemen'), null);
  assert.equal(normalizeType('Zijde inleg', 'Manchetknopen'), null);
  // Maar een jeans is een broek-type, geen stofkeuze.
  assert.equal(normalizeType('Jeans', 'Broeken'), 'Jeans');
  // En "Elastisch" (riem) lijkt op stretch maar is een uitvoering.
  assert.equal(normalizeType('Elastisch', 'Riemen'), 'Elastisch');
});

test('interne codes en modelnamen zijn geen filterkeuze', () => {
  // "Polo riva katoen" — riva is een interne stofnaam.
  assert.equal(normalizeType('Riva', 'Polo-shirts'), null);
  assert.equal(normalizeType('Verpakking', 'Overhemden'), null);
  assert.equal(normalizeType('Diversen', 'Overhemden'), null);
  assert.equal(normalizeType('', 'Overhemden'), null);
});

test('een type dat de soort herhaalt is geen keuze', () => {
  assert.equal(normalizeType('Sokken', 'Sokken'), null);
  assert.equal(normalizeType('Bretels', 'Bretels'), null);
  assert.equal(normalizeType('Dasspelden', 'Dasspelden'), null);
  // Alleen letters vergelijken: "T-Shirts" vs "T shirts" is hetzelfde woord.
  assert.equal(normalizeType('T-Shirts', 'T-Shirts'), null);
  // Zonder soort kán die regel niet — dan blijft de waarde staan.
  assert.equal(normalizeType('Sokken'), 'Sokken');
});

test('echte typewaarden blijven ongemoeid', () => {
  assert.equal(normalizeType('Lange mouw', 'Overhemden'), 'Lange mouw');
  assert.equal(normalizeType('2-delig', 'Pakken'), '2-delig');
  assert.equal(normalizeType('Casual', 'Colberts'), 'Casual');
  assert.equal(normalizeType('Veterschoen', 'Schoenen'), 'Veterschoen');
  assert.equal(normalizeType('Windstopper', 'Jassen'), 'Windstopper');
});

test('oude filterlinks blijven werken — expandType zoekt de rauwe bronwaarden', () => {
  // Nieuwe URL: één keuze die beide bronwaarden moet vinden.
  const coltrui = expandType('Coltrui');
  assert.ok(coltrui.includes('Coltrui') && coltrui.includes('Turtleneck'), coltrui.join(','));
  const rits = expandType('Met rits');
  assert.ok(rits.includes('Full-zip') && rits.includes('Rits'), rits.join(','));
  const mm = expandType('Mix & match');
  assert.ok(mm.includes('MM') && mm.includes('Gilet MM'), mm.join(','));
  const pakken = expandType('Pakken');
  assert.ok(pakken.includes('Pakken Modern Fit') && pakken.includes('Pakken Slim Fit'), pakken.join(','));

  // Oude URL (?type=Turtleneck) blijft de rauwe waarde zoeken en dus werken.
  assert.deepEqual(expandType('Turtleneck'), ['Turtleneck']);
  assert.deepEqual(expandType('V-neck'), ['V-neck']);
});

test('drempel: een keuze met één artikel is ruis', () => {
  assert.equal(TYPE_MIN_COUNT, 2);
});
