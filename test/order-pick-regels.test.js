import test from "node:test";
import assert from "node:assert/strict";
import { orderPickRefBase, orderPickStand, orderPickBeslissing } from "../lib/order-pick-regels.js";

/* Het gereedmelden van een winkeldeel boekt sinds de voorraad-fix een échte
   −1-movement. Fout in déze logica betekent stille voorraad-drift: een dubbele
   pick boekt 2× af (winkel lijkt leeg), een gemiste her-pick na undo boekt 0×
   (verkocht stuk telt eeuwig als beschikbaar). Vandaar tests op de regels zelf. */

const BASE = orderPickRefBase("1041", "gents groningen");

test("ref-basis: spaties plat naar streepjes, leeg bij ontbrekende delen", () => {
  assert.equal(BASE, "ORDERPICK-1041-gents-groningen");
  assert.equal(orderPickRefBase("", "gents groningen"), "");
  assert.equal(orderPickRefBase("1041", "  "), "");
});

test("eerste pick boekt −1 op de kale basis-ref", () => {
  const r = orderPickBeslissing([], BASE, true);
  assert.deepEqual(r, { boek: true, ref: BASE, sign: -1 });
});

test("herhaalde pick (dubbelklik/retry) boekt niets maar geeft de staande ref terug", () => {
  const r = orderPickBeslissing([BASE], BASE, true);
  assert.equal(r.boek, false);
  // De staande ref gaat mee zodat storegents een eerder gemiste SRS-sync-markering
  // alsnog kan herkansen.
  assert.equal(r.ref, BASE);
});

test("undo compenseert met +1 op een eigen UNDO-ref", () => {
  const r = orderPickBeslissing([BASE], BASE, false);
  assert.deepEqual(r, { boek: true, ref: `${BASE}-UNDO-1`, sign: 1 });
});

test("undo zonder staande pick (nooit gepickt of al teruggedraaid) boekt niets", () => {
  assert.equal(orderPickBeslissing([], BASE, false).boek, false);
  assert.equal(orderPickBeslissing([BASE, `${BASE}-UNDO-1`], BASE, false).boek, false);
});

test("her-pick na undo krijgt een NIEUWE ref (-2) — de kernreden van het tellertje", () => {
  // Eén vaste ref zou hier stil conflicteren (onConflictDoNothing) en per saldo 0
  // boeken: het verkochte stuk telt dan eeuwig als beschikbaar.
  const r = orderPickBeslissing([BASE, `${BASE}-UNDO-1`], BASE, true);
  assert.deepEqual(r, { boek: true, ref: `${BASE}-2`, sign: -1 });
});

test("tweede undo en derde pick nummeren door", () => {
  const refs = [BASE, `${BASE}-UNDO-1`, `${BASE}-2`];
  assert.deepEqual(orderPickBeslissing(refs, BASE, false), { boek: true, ref: `${BASE}-UNDO-2`, sign: 1 });
  const refs2 = [...refs, `${BASE}-UNDO-2`];
  assert.deepEqual(orderPickBeslissing(refs2, BASE, true), { boek: true, ref: `${BASE}-3`, sign: -1 });
});

test("stand: staande ref volgt de tellerstand, niet lexicografische sortering", () => {
  // base-10 sorteert lexicografisch vóór base-2; de stand moet uit de teller komen.
  const refs = [BASE];
  for (let i = 1; i <= 9; i += 1) refs.push(`${BASE}-UNDO-${i}`, `${BASE}-${i + 1}`);
  const stand = orderPickStand(refs, BASE);
  assert.equal(stand.picks, 10);
  assert.equal(stand.undos, 9);
  assert.equal(stand.openstaand, true);
  assert.equal(stand.staandeRef, `${BASE}-10`);
});

test("dubbele/lege refs in de invoer tellen niet dubbel", () => {
  const stand = orderPickStand([BASE, BASE, "", null, `${BASE}-UNDO-1`, `${BASE}-UNDO-1`], BASE);
  assert.equal(stand.picks, 1);
  assert.equal(stand.undos, 1);
  assert.equal(stand.openstaand, false);
});

test("zonder basis-ref (onbekende winkel/order) wordt er nooit geboekt", () => {
  assert.deepEqual(orderPickBeslissing([BASE], "", true), { boek: false, ref: null });
});
