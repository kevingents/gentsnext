import test from "node:test";
import assert from "node:assert/strict";
import { safetyKey, verdeelBudget } from "../lib/veiligheidsvoorraad-regels.js";

/* De marge is een budget PER ARTIKEL ("2 stuks totaal over alle maten"). Ging dit
   mis, dan hield de site 44.855 van de 55.999 stuks winkelvoorraad vast in plaats
   van ~19.500. Vandaar tests op de verdeling zelf. */

const rij = (branchId, sku, qty) => ({ branchId, sku, qty });
const totaal = (m) => [...m.values()].reduce((a, b) => a + b, 0);

test("budget 2 wordt één keer per artikel vastgelegd, niet per maat", () => {
  // 5 maten × 17 winkels, overal 1 stuk — vroeger 85 vastgehouden, nu 2.
  const rows = [];
  for (let filiaal = 1; filiaal <= 17; filiaal++) {
    for (const maat of ["s", "m", "l", "xl", "xxl"]) rows.push(rij(String(filiaal), maat, 1));
  }
  const alloc = verdeelBudget(rows, 2, new Map());
  assert.equal(totaal(alloc), 2);
});

test("dunste regel eerst: de diepe maat blijft verkoopbaar", () => {
  const rows = [rij("4", "s", 6), rij("4", "m", 1), rij("9", "l", 1)];
  const alloc = verdeelBudget(rows, 2, new Map());
  assert.equal(alloc.get(safetyKey("4", "m")), 1);
  assert.equal(alloc.get(safetyKey("9", "l")), 1);
  assert.equal(alloc.get(safetyKey("4", "s")), undefined); // 6 stuks blijven heel
});

test("budget verdeelt over twee regels in plaats van één regel leeg te trekken", () => {
  const rows = [rij("1", "s", 3), rij("2", "s", 3)];
  const alloc = verdeelBudget(rows, 2, new Map());
  assert.equal(alloc.get(safetyKey("1", "s")), 1);
  assert.equal(alloc.get(safetyKey("2", "s")), 1);
});

test("budget groter dan de voorraad legt hooguit de voorraad vast", () => {
  const rows = [rij("1", "s", 1), rij("2", "s", 2)];
  const alloc = verdeelBudget(rows, 99, new Map());
  assert.equal(totaal(alloc), 3);
  assert.equal(alloc.get(safetyKey("2", "s")), 2);
});

test("budget 0 legt niets vast (kassa-kanaal)", () => {
  const alloc = verdeelBudget([rij("1", "s", 5)], 0, new Map());
  assert.equal(alloc.size, 0);
});

test("regels zonder voorraad tellen niet mee", () => {
  const alloc = verdeelBudget([rij("1", "s", 0), rij("2", "s", -3), rij("3", "s", 1)], 2, new Map());
  assert.equal(totaal(alloc), 1);
  assert.equal(alloc.get(safetyKey("3", "s")), 1);
});

test("uitkomst is deterministisch, ongeacht de volgorde van de invoer", () => {
  const rows = [rij("12", "m", 2), rij("3", "s", 2), rij("7", "l", 2), rij("3", "xl", 2)];
  const a = verdeelBudget(rows, 3, new Map());
  const b = verdeelBudget([...rows].reverse(), 3, new Map());
  assert.deepEqual([...a].sort(), [...b].sort());
  // Filiaalnummers sorteren numeriek, niet alfabetisch: 3 vóór 12.
  assert.equal(a.get(safetyKey("3", "s")), 1);
  assert.equal(a.get(safetyKey("3", "xl")), 1);
  assert.equal(a.get(safetyKey("7", "l")), 1);
});

test("sleutel is hoofdletterongevoelig op de artikelsleutel", () => {
  assert.equal(safetyKey("4", "ABC123"), safetyKey("4", "abc123"));
});
