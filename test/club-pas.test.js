/**
 * De clubpas is het enige scherm in het account dat een APPARAAT moet lezen in
 * plaats van een mens. Twee fouten zijn daarom hier duurder dan elders, en
 * allebei zien ze er goed uit:
 *
 *  1. Een lidcode die niet meer overeenkomt met wat de kassa afsnijdt. De klant
 *     leest 'm voor, de kassier vindt niets of — erger — de verkeerde klant.
 *  2. Een gespiegelde of geïnverteerde QR. Voor een mens niet van echt te
 *     onderscheiden; voor een scanner onleesbaar.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lidcode, qrPad } from "../lib/club-pas-regels.js";

const KLANT = "9f1c2d3e-4b5a-6789-abcd-ef0123456789";

test("de lidcode is 'GENTS' + de eerste 8 tekens van het id, in hoofdletters", () => {
  assert.equal(lidcode(KLANT), "GENTS 9F1C2D3E");
});

test("streepjes tellen niet mee — anders staan er maar 8 tekens minus streepjes op de pas", () => {
  assert.equal(lidcode("ab-cd-ef-12-34"), "GENTS ABCDEF12");
});

test("de kassa snijdt 8 tekens af; de pas mag er dus geen 7 of 9 tonen", () => {
  // Deze test bewaakt een afspraak met /api/core/customer-search: die zoekt op
  // precies dezelfde prefix en weigert een code die op twee klanten matcht.
  assert.equal(lidcode(KLANT).replace("GENTS ", "").length, 8);
});

test("een leeg of ontbrekend id levert geen half lidnummer op", () => {
  assert.equal(lidcode(""), "GENTS ");
  assert.equal(lidcode(undefined), "GENTS ");
});

test("het pad zet kolom op x en rij op y — niet andersom, want gespiegeld ziet er goed uit", () => {
  // Eén donkere module op rij 1, kolom 0. Verwisseld zou dit "M1 0" worden.
  const pad = qrPad(["00", "10"], 0);
  assert.equal(pad, "M0 1h1v1h-1z");
});

test("de stille rand schuift élke module mee op", () => {
  assert.equal(qrPad(["1"], 4), "M4 4h1v1h-1z");
});

test("nullen leveren niets op — een geïnverteerde code is geen code", () => {
  assert.equal(qrPad(["000", "000"], 0), "");
});

test("de renderer gebruikt deze regels ook echt (geen tweede kopie in de component)", () => {
  // Zonder deze controle kan iemand het pad in de component herschrijven en
  // blijven de tests hierboven groen terwijl ze niets meer bewaken.
  const component = readFileSync(new URL("../components/account/club-pass.tsx", import.meta.url), "utf8");
  assert.match(component, /from "@\/lib\/club-pas-regels"/);
  assert.match(component, /qrPad\(/);
});

test("de QR bevat het KALE klant-id — geen URL, geen prefix", () => {
  // De kassa herkent een UUID en zoekt daar hard op; met een URL eromheen valt
  // de scan terug op de ILIKE-zoek over e-mail/naam en geeft 'geen klant'.
  const bron = readFileSync(new URL("../lib/club-pass.ts", import.meta.url), "utf8");
  assert.match(bron, /addData\(String\(customerId\)\)/);
});
