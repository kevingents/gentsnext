import test from "node:test";
import assert from "node:assert/strict";
import { RETURN_REASONS, REASON_NOTE_SEP, returnReason, canonicalReturnReason } from "../lib/retour-redenen.js";

/* Deze regel bepaalt wat er in `returns.reason` belandt — en daarmee wat het
   retour-dashboard laat zien. Een lege of versplinterde reden merk je pas als
   de grafiek maanden later nietszeggend blijkt, dus: onder test. */

test("een bekende code levert precies het vaste label op", () => {
  assert.equal(canonicalReturnReason("te_groot"), "Te groot");
  assert.equal(canonicalReturnReason(" te_groot "), "Te groot");
});

test("een onbekende of lege code levert niets op — createReturn weigert daarop", () => {
  for (const code of ["", "   ", "onzin", "TE_GROOT"]) {
    assert.equal(canonicalReturnReason(code, "met toelichting"), "");
  }
});

test("een toelichting komt achter het label, met het scheidingsteken ertussen", () => {
  const r = canonicalReturnReason("te_groot", "schouders vielen ruim");
  assert.equal(r, `Te groot${REASON_NOTE_SEP}schouders vielen ruim`);
  // Het deel vóór het scheidingsteken is waar de statistieken op groeperen.
  assert.equal(r.split(REASON_NOTE_SEP)[0], "Te groot");
});

test("redenen die om een toelichting vragen worden zonder toelichting geweigerd", () => {
  for (const r of RETURN_REASONS.filter((x) => x.needsNote)) {
    assert.equal(canonicalReturnReason(r.code), "", `${r.code} zonder toelichting`);
    assert.equal(canonicalReturnReason(r.code, "   "), "", `${r.code} met witruimte`);
    assert.ok(canonicalReturnReason(r.code, "rits kapot").startsWith(r.label));
  }
});

test("witruimte en regeleinden in de toelichting worden platgeslagen", () => {
  assert.equal(canonicalReturnReason("anders", "  te\n\n  laat  voor \t de bruiloft "), `Andere reden${REASON_NOTE_SEP}te laat voor de bruiloft`);
});

test("een uitzinnig lange toelichting wordt afgekapt binnen de kolombreedte", () => {
  const lang = canonicalReturnReason("anders", "x".repeat(5000));
  assert.ok(lang.length <= 500, `lengte ${lang.length}`);
});

test("geen enkel label bevat zelf het scheidingsteken — anders splitst de grafiek verkeerd", () => {
  for (const r of RETURN_REASONS) assert.ok(!r.label.includes(REASON_NOTE_SEP), r.code);
});

test("codes en labels zijn uniek, en elke reden heeft een vertaalsleutel", () => {
  assert.equal(new Set(RETURN_REASONS.map((r) => r.code)).size, RETURN_REASONS.length);
  assert.equal(new Set(RETURN_REASONS.map((r) => r.label)).size, RETURN_REASONS.length);
  for (const r of RETURN_REASONS) assert.match(r.key, /^retourneren\.reason\./);
});

test("er is minstens één pasvorm-reden die de vermaak-hint aanzet", () => {
  const fit = RETURN_REASONS.filter((r) => r.alteration);
  assert.ok(fit.length >= 3, `${fit.length} pasvorm-redenen`);
  assert.equal(returnReason("te_groot")?.alteration, true);
  // Een kapot artikel vermaak je niet — daar hoort geen pasafspraak-aanbod bij.
  assert.notEqual(returnReason("beschadigd")?.alteration, true);
});
