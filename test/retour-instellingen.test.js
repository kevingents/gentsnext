import test from "node:test";
import assert from "node:assert/strict";
import { schoonReturnConfig, WETTELIJKE_BEDENKTIJD_DAGEN, MAX_RETOURKOSTEN_CENTS } from "../lib/retour-instellingen.js";

/* Dit is de grens tussen een invoerveld in de portal en wat we een klant in
   rekening brengen — en tussen een invoerveld en de wettelijke bedenktijd.
   Beide horen niet af te hangen van wie er toevallig iets intypt. */

const HUIDIG = {
  windowDays: 14,
  dhlReturnCostCents: 499,
  freeOnCredit: true,
  signalMinReturns: 3,
  signalMinRatePct: 30,
  signalFastDays: 7,
};

test("een normale wijziging komt er gewoon doorheen", () => {
  const r = schoonReturnConfig({ dhlReturnCostCents: 794 }, HUIDIG);
  assert.equal(r.dhlReturnCostCents, 794);
  // Wat niet meegestuurd is blijft staan — updateSettings merget ondiep.
  assert.equal(r.windowDays, 14);
  assert.equal(r.freeOnCredit, true);
  assert.equal(r.signalMinReturns, 3);
});

test("de bedenktijd kan niet onder de wettelijke 14 dagen", () => {
  for (const poging of [0, 1, 7, 13, -30]) {
    assert.equal(schoonReturnConfig({ windowDays: poging }, HUIDIG).windowDays, WETTELIJKE_BEDENKTIJD_DAGEN);
  }
  // Ruimer dan de wet mag wel — dat is een belofte, geen overtreding.
  assert.equal(schoonReturnConfig({ windowDays: 60 }, HUIDIG).windowDays, 60);
  assert.equal(schoonReturnConfig({ windowDays: 9999 }, HUIDIG).windowDays, 365);
});

test("een verschoven komma in de retourkosten wordt afgevangen", () => {
  // 794 cent bedoeld, 79400 getypt: dat mag geen € 794 van een refund afhalen.
  assert.equal(schoonReturnConfig({ dhlReturnCostCents: 79400 }, HUIDIG).dhlReturnCostCents, MAX_RETOURKOSTEN_CENTS);
  assert.equal(schoonReturnConfig({ dhlReturnCostCents: -100 }, HUIDIG).dhlReturnCostCents, 0);
  // Gratis retour instellen moet gewoon kunnen.
  assert.equal(schoonReturnConfig({ dhlReturnCostCents: 0 }, HUIDIG).dhlReturnCostCents, 0);
});

test("een leeg of onleesbaar veld laat de huidige waarde staan i.p.v. 'm op nul te zetten", () => {
  for (const rommel of ["", null, undefined, "abc", NaN, {}]) {
    const r = schoonReturnConfig({ dhlReturnCostCents: rommel }, HUIDIG);
    assert.equal(r.dhlReturnCostCents, 499, `bij ${JSON.stringify(rommel)}`);
  }
});

test("kommagetallen worden afgerond — centen zijn hele getallen", () => {
  assert.equal(schoonReturnConfig({ dhlReturnCostCents: 794.6 }, HUIDIG).dhlReturnCostCents, 795);
  assert.equal(schoonReturnConfig({ windowDays: 14.4 }, HUIDIG).windowDays, 14);
});

test("gratis-bij-tegoed is uit te zetten, maar niet per ongeluk door weglaten", () => {
  assert.equal(schoonReturnConfig({ freeOnCredit: false }, HUIDIG).freeOnCredit, false);
  assert.equal(schoonReturnConfig({ dhlReturnCostCents: 500 }, HUIDIG).freeOnCredit, true);
});

test("signaaldrempels blijven binnen bereik", () => {
  const r = schoonReturnConfig({ signalMinReturns: 0, signalMinRatePct: 500, signalFastDays: 0 }, HUIDIG);
  assert.equal(r.signalMinReturns, 1);
  assert.equal(r.signalMinRatePct, 100);
  assert.equal(r.signalFastDays, 1);
});

test("niets bruikbaars meegestuurd = niets aanpassen", () => {
  for (const leeg of [null, undefined, "", 42, []]) {
    assert.equal(schoonReturnConfig(leeg, HUIDIG), null);
  }
});
