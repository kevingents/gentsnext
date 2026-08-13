import test from "node:test";
import assert from "node:assert/strict";
import { loopt, puntenVoorActie, regelMatcht, schoneActies } from "../lib/punten-acties-regels.js";

/* Een puntenactie deelt geld uit: elke fout hier raakt elke klant die iets
   koopt. Vandaar tests op de wiskunde, de grenzen en de sanitizer. */

const pak = { sku: "29001", qty: 1, bedragCents: 29900, hoofdgroep: "Pakken", merk: "GENTS" };
const das = { sku: "29002", qty: 2, bedragCents: 5000, hoofdgroep: "Stropdassen", merk: "Michaelis" };

const actie = (over = {}) => ({
  slug: "test",
  naam: "Test",
  actief: true,
  voorwaarde: {},
  beloning: { soort: "vast", punten: 100 },
  maxPerOrder: 0,
  ...over,
});

/* ── Matchen ──────────────────────────────────────────────────────────────── */

test("lege voorwaarde matcht alles", () => {
  assert.equal(regelMatcht(pak, {}), true);
  assert.equal(regelMatcht(das, {}), true);
});

test("hoofdgroep en merk matchen hoofdletter-ongevoelig", () => {
  assert.equal(regelMatcht(pak, { hoofdgroepen: ["pakken"] }), true);
  assert.equal(regelMatcht(pak, { merken: ["  GENTS "] }), true);
  assert.equal(regelMatcht(pak, { hoofdgroepen: ["Stropdassen"] }), false);
});

test("meerdere eisen gelden samen (EN, niet OF)", () => {
  assert.equal(regelMatcht(pak, { hoofdgroepen: ["Pakken"], merken: ["Michaelis"] }), false);
  assert.equal(regelMatcht(pak, { hoofdgroepen: ["Pakken"], merken: ["GENTS"] }), true);
});

/* ── Rekenen ──────────────────────────────────────────────────────────────── */

test("vast bedrag geeft één keer punten, hoeveel regels er ook matchen", () => {
  assert.equal(puntenVoorActie(actie(), [pak, das]), 100);
});

test("per euro rekent over de matchende regels en rondt naar beneden", () => {
  const a = actie({ voorwaarde: { hoofdgroepen: ["Pakken"] }, beloning: { soort: "per_euro", puntenPerEuro: 2 } });
  // € 299 × 2 = 598 punten; de das telt niet mee.
  assert.equal(puntenVoorActie(a, [pak, das]), 598);
});

test("een halve punt per euro levert nooit een halve punt op", () => {
  const a = actie({ beloning: { soort: "per_euro", puntenPerEuro: 0.5 }, voorwaarde: { skus: ["29002"] } });
  // € 50 × 0,5 = 25 punten, en het blijft een heel getal.
  const p = puntenVoorActie(a, [das]);
  assert.equal(p, 25);
  assert.equal(Number.isInteger(p), true);
});

test("per artikel telt de aantallen, niet de regels", () => {
  const a = actie({ beloning: { soort: "per_artikel", punten: 10 } });
  assert.equal(puntenVoorActie(a, [pak, das]), 30); // 1 pak + 2 dassen
});

test("de drempel telt over de MATCHENDE regels, niet over de hele order", () => {
  const a = actie({
    voorwaarde: { hoofdgroepen: ["Stropdassen"], minBestedingCents: 10000 },
    beloning: { soort: "vast", punten: 100 },
  });
  // Dassen zijn € 50; het pak van € 299 mag die drempel niet halen.
  assert.equal(puntenVoorActie(a, [pak, das]), 0);
});

test("plafond per order kapt een te gulle actie af", () => {
  const a = actie({ beloning: { soort: "per_artikel", punten: 1000 }, maxPerOrder: 250 });
  assert.equal(puntenVoorActie(a, [pak, das]), 250);
});

test("geen enkele matchende regel = geen punten", () => {
  const a = actie({ voorwaarde: { skus: ["bestaat-niet"] } });
  assert.equal(puntenVoorActie(a, [pak, das]), 0);
});

/* ── Looptijd ─────────────────────────────────────────────────────────────── */

test("een actie loopt tot en met de laatste dag, Amsterdamse tijd", () => {
  const a = actie({ van: "2026-08-01", tot: "2026-08-31" });
  // 31 augustus 23:00 UTC = 1 september 01:00 in Amsterdam → voorbij.
  assert.equal(loopt(a, new Date("2026-08-31T21:00:00Z")), true); // 23:00 NL, laatste avond
  assert.equal(loopt(a, new Date("2026-08-31T23:00:00Z")), false); // al 1 sept in NL
  assert.equal(loopt(a, new Date("2026-07-31T23:00:00Z")), true); // al 1 aug in NL
});

test("uitgezette actie loopt nooit", () => {
  assert.equal(loopt(actie({ actief: false }), new Date()), false);
});

/* ── Sanitizer ────────────────────────────────────────────────────────────── */

test("een actie zonder geldige code of naam valt af", () => {
  const uit = schoneActies([
    { slug: "GOED-1", naam: "Prima" },
    { slug: "fout code", naam: "Spatie in de code" },
    { slug: "geen-naam", naam: "   " },
    { naam: "Geen code" },
  ]);
  assert.deepEqual(uit.map((a) => a.slug), ["goed-1"]);
});

test("dubbele codes vallen af — anders vechten twee acties om dezelfde regel", () => {
  const uit = schoneActies([
    { slug: "zomer", naam: "Eerste" },
    { slug: "zomer", naam: "Tweede" },
  ]);
  assert.equal(uit.length, 1);
  assert.equal(uit[0].naam, "Eerste");
});

test("bedragen worden geklemd en onzin wordt 0", () => {
  const [a] = schoneActies([{ slug: "x", naam: "X", beloning: { soort: "vast", punten: 999999999 }, maxPerOrder: -5 }]);
  assert.equal(a.beloning.punten, 100000);
  assert.equal(a.maxPerOrder, 0);
  const [b] = schoneActies([{ slug: "y", naam: "Y", beloning: { soort: "vast", punten: "geen getal" } }]);
  assert.equal(b.beloning.punten, 0);
});

test("een onbekende beloningssoort wordt een vast bedrag, geen crash", () => {
  const [a] = schoneActies([{ slug: "z", naam: "Z", beloning: { soort: "gratis-auto", punten: 10 } }]);
  assert.equal(a.beloning.soort, "vast");
  assert.equal(a.beloning.punten, 10);
});

test("een scheve datum wordt genegeerd in plaats van de actie te slopen", () => {
  const [a] = schoneActies([{ slug: "d", naam: "D", van: "01-08-2026", tot: "2026-08-31" }]);
  assert.equal(a.van, undefined);
  assert.equal(a.tot, "2026-08-31");
});
