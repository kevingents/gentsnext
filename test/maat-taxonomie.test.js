import test from "node:test";
import assert from "node:assert/strict";
import {
  sizeRowLabel,
  sizeFacetFor,
  sizeGroup,
  sizeSleeveBase,
  sizeLayoutFor,
  sizeFilterBranches,
} from "../lib/size-taxonomy.ts";

/* Hetzelfde GETAL betekent in twee reeksen iets anders: 44 is pakmaat XS én
   overhemd-boordmaat XL. Zonder familie won overal de pakkenreeks, waardoor een
   4XL-hals in de bucket XS belandde en "Shop in jouw maat" de verkeerde
   overhemden voorselecteerde. Deze tests bewaken die scheiding. */

const SHIRT = "Overhemden";

test("boordmaat leest als hals, niet als pakmaat", () => {
  for (const [maat, rij] of [
    ["42", "L"], ["44", "XL"], ["46", "XXL"],
    ["48", "3XL"], ["50", "4XL"], ["52", "5XL"],
  ]) {
    assert.equal(sizeRowLabel(maat, SHIRT), rij, `boordmaat ${maat}`);
  }
});

test("pak- en broekmaten blijven de kledingreeks houden", () => {
  assert.equal(sizeRowLabel("42", "Pakken"), "XXS");
  assert.equal(sizeRowLabel("44", "Colberts"), "XS");
  assert.equal(sizeRowLabel("50", "Broeken"), "M/L");
  assert.equal(sizeRowLabel("98", "Broeken"), "M/L"); // lengtemaat
  assert.equal(sizeRowLabel("25", "Colberts"), "M/L"); // kwartmaat
});

test("boordmaten aan de uiteinden vallen niet meer buiten de reeks", () => {
  // 35, 47, 49, 51 en 53 bleven als kaal getal in het filter staan.
  assert.equal(sizeRowLabel("35", SHIRT), "XS");
  assert.equal(sizeRowLabel("47", SHIRT), "3XL");
  assert.equal(sizeRowLabel("51", SHIRT), "5XL");
  assert.equal(sizeRowLabel("53", SHIRT), "6XL");
});

test("mouwlengte 7 met streepje hoort bij dezelfde boordmaat", () => {
  assert.equal(sizeRowLabel("39-7", SHIRT), sizeRowLabel("39", SHIRT));
  assert.equal(sizeRowLabel("44-7", SHIRT), "XL");
  assert.deepEqual(sizeFacetFor("overhemden", "39-7"), { system: "boord", value: "39" });
});

test("lettermaat-overhemden blijven kleding (L 41/42 is geen boordmaat)", () => {
  assert.deepEqual(sizeFacetFor("overhemden", "XL 43/44"), { system: "kleding", value: "XL" });
  assert.equal(sizeRowLabel("XL7 43/44", SHIRT), "XL");
});

test("39-7 staat in de mouwlengte-kolom, 27 niet", () => {
  const layout = sizeLayoutFor(SHIRT, ["33", "33-7"]);
  assert.equal(sizeGroup("39-7", layout), "long");
  assert.equal(sizeGroup("XL7 43/44", layout), "long");
  assert.equal(sizeGroup("39", layout), "regular");
  assert.equal(sizeGroup("27", layout), "regular"); // kwartmaat, geen mouwlengte
});

test("knoptekst onder de mouwlengte-tab laat de maat heel", () => {
  assert.equal(sizeSleeveBase("39-7"), "39"); // getal blijft getal
  assert.equal(sizeSleeveBase("XL7 43/44"), "XL");
  assert.equal(sizeSleeveBase("39"), "39");
});

test("filter op boordmaat 39 pakt ook de mouwlengte-7-variant mee", () => {
  const takken = sizeFilterBranches("bo.39");
  assert.deepEqual(takken, [{ famClass: "overhemd", tokens: ["39", "39-7"] }]);
});

test("schoenmaat en boordmaat blijven gescheiden systemen", () => {
  assert.deepEqual(sizeFacetFor("schoenen", "43"), { system: "schoen", value: "43" });
  assert.deepEqual(sizeFacetFor("overhemden", "43"), { system: "boord", value: "43" });
});

test("schoen, riem en sok houden hun eigen getal", () => {
  // Schoenmaat 43 werd "XL" — dan droeg "nieuw in jouw maat" bij schoenmaat 43
  // ook alle XL-kleding aan. En 47 werd na het aanvullen van de boordreeks 3XL.
  assert.equal(sizeRowLabel("43", "Schoenen"), "43");
  assert.equal(sizeRowLabel("47", "Schoenen"), "47");
  assert.equal(sizeRowLabel("100", "Riemen"), "100");
  assert.equal(sizeRowLabel("39-42", "Sokken"), "39-42");
  assert.equal(sizeRowLabel("M", "Sokken"), "M"); // lettermaat mag wél
});

test("broek- en colbertmaten buiten de reeks blijven staan zoals ze zijn", () => {
  // 33/34 zijn dames-/inchmaten bij broeken, geen boordmaten.
  assert.equal(sizeRowLabel("33", "Broeken"), "33");
  assert.equal(sizeRowLabel("34", "Colberts"), "34");
  assert.equal(sizeRowLabel("34", "Gilets"), "34");
});
