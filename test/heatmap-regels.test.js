import test from "node:test";
import assert from "node:assert/strict";
import {
  GEMETEN_PAGINAS,
  apparaatVoorBreedte,
  magLabelVastleggen,
  medianeUitBuckets,
  schoonLabel,
  selectorNaarCss,
  sjabloonVoorKaalPad,
  titelVoorPagina,
} from "../lib/heatmap-regels.js";

/* De heatmap meet op een ALLOWLIST. Gaat daar iets mis, dan verzamelt hij stil
   klikposities op pagina's met klantgegevens erop — en dat merk je pas als
   iemand het vraagt. Vandaar tests op de twee dingen die dat bewaken: welke
   pagina's meedoen, en wat er in een label terechtkomt. */

test("de gemeten pagina's zijn precies de bedoelde", () => {
  assert.deepEqual(
    GEMETEN_PAGINAS.map((p) => p.key).sort(),
    [
      "/",
      "/afrekenen",
      "/categorie/[slug]",
      "/collections",
      "/collections/[handle]",
      "/products/[handle]",
      "/winkelwagen",
      "/zoeken",
    ]
  );
});

test("echte URL's vallen op het juiste sjabloon", () => {
  assert.equal(sjabloonVoorKaalPad("/"), "/");
  assert.equal(sjabloonVoorKaalPad("/products/blauw-pak-slim"), "/products/[handle]");
  assert.equal(sjabloonVoorKaalPad("/categorie/pakken"), "/categorie/[slug]");
  assert.equal(sjabloonVoorKaalPad("/collections"), "/collections");
  assert.equal(sjabloonVoorKaalPad("/collections/najaar"), "/collections/[handle]");
  assert.equal(sjabloonVoorKaalPad("/winkelwagen/"), "/winkelwagen", "slotslash hoort weg te vallen");
});

test("pagina's met klantgegevens worden NIET gemeten", () => {
  for (const pad of [
    "/account",
    "/account/login",
    "/bestelling/GN-10024",
    "/review/GN-10024",
    "/vraag/abc123",
    "/punten-claim",
    "/profiel-afronden",
    "/retourneren",
  ]) {
    assert.equal(sjabloonVoorKaalPad(pad), "", `${pad} hoort niet gemeten te worden`);
  }
});

test("een subpad van een gemeten pagina glipt er niet in", () => {
  // /products/[handle] mag niet ook /products/x/reviews opslokken: dat is een
  // andere pagina met een andere indeling, en de vlekken zouden samensmelten.
  assert.equal(sjabloonVoorKaalPad("/products/blauw-pak/reviews"), "");
  assert.equal(sjabloonVoorKaalPad("/account/bestellingen"), "");
});

test("querystring en hash horen niet in de sleutel", () => {
  // ?q= draagt de zoekterm mee en ?utm_ de campagne; die mogen niet als
  // onderdeel van een paginasleutel in een aggregatietabel belanden.
  assert.equal(sjabloonVoorKaalPad("/zoeken?q=trouwpak+blauw"), "/zoeken");
  assert.equal(sjabloonVoorKaalPad("/products/pak?utm_source=meta#maat"), "/products/[handle]");
});

test("labels worden op de checkout niet vastgelegd", () => {
  assert.equal(magLabelVastleggen("/afrekenen"), false);
  assert.equal(magLabelVastleggen("/products/[handle]"), true);
});

test("mogelijke persoonsgegevens worden uit een label gehaald", () => {
  assert.ok(!schoonLabel("Mail naar kevin@gents.nl").includes("@"), "e-mailadres blijft staan");
  assert.ok(!/06/.test(schoonLabel("Bel 06 12345678")), "telefoonnummer blijft staan");
  assert.ok(!/1234\s?AB/.test(schoonLabel("Bezorgen op 1234 AB")), "postcode blijft staan");
  assert.ok(!/\d{5,}/.test(schoonLabel("Bestelling 100245789")), "lang nummer blijft staan");
});

test("een gewoon knoplabel blijft gewoon staan", () => {
  assert.equal(schoonLabel("  In   winkelwagen "), "In winkelwagen");
  assert.equal(schoonLabel("Maat 52"), "Maat 52", "korte getallen zijn maten, geen nummers");
});

test("labels worden afgekapt en blijven nooit half gemaskeerd achter", () => {
  const lang = schoonLabel("a".repeat(200));
  assert.ok(lang.length <= 60, `${lang.length} tekens`);
  // Bleef er na het schoonmaken alleen ruis over, dan liever niets: een label
  // "…" naast een klikteller is misleidender dan een leeg veld.
  assert.equal(schoonLabel("kevin@gents.nl"), "");
  assert.equal(schoonLabel("   "), "");
});

test("apparaat-emmers volgen de breakpoints", () => {
  assert.equal(apparaatVoorBreedte(390), "mobiel");
  assert.equal(apparaatVoorBreedte(767), "mobiel");
  assert.equal(apparaatVoorBreedte(768), "tablet");
  assert.equal(apparaatVoorBreedte(1023), "tablet");
  assert.equal(apparaatVoorBreedte(1024), "desktop");
});

test("selector met data-heat wordt een geldige CSS-selector", () => {
  assert.equal(selectorNaarCss("@buybox>button:nth-of-type(2)"), '[data-heat="buybox"] > button:nth-of-type(2)');
  assert.equal(selectorNaarCss("div>a"), "div > a");
});

test("mediane scroll is de diepste drempel die de helft nog haalde", () => {
  // 100 weergaven; 60 haalden 50%, 40 haalden 75%, 10 haalden 100%.
  const b = new Map([
    [0, 100],
    [25, 80],
    [50, 60],
    [75, 40],
    [100, 10],
  ]);
  assert.equal(medianeUitBuckets(b), 50);
  assert.equal(medianeUitBuckets(new Map()), 0, "geen weergaven = 0, niet NaN");
  assert.equal(medianeUitBuckets(new Map([[0, 0]])), 0);
});

test("elke gemeten pagina heeft een leesbare titel", () => {
  for (const p of GEMETEN_PAGINAS) {
    assert.equal(titelVoorPagina(p.key), p.titel);
    assert.ok(p.titel && p.titel !== p.key, `${p.key} heeft geen eigen titel`);
  }
  assert.equal(titelVoorPagina("/bestaat-niet"), "/bestaat-niet", "onbekend valt terug op de sleutel");
});
