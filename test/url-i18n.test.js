import test from "node:test";
import assert from "node:assert/strict";
import {
  URL_LOCALES, URL_DEFAULT_LOCALE, SEGMENTS, SLUGS,
  vertaalPad, ontvertaalPad, publiekPad, lokaliseerHref,
} from "../lib/url-i18n-regels.js";

const VREEMD = URL_LOCALES.filter((l) => l !== URL_DEFAULT_LOCALE);

/* De middleware rewrite een gelokaliseerd pad terug naar het Nederlandse
   routebestand. Klopt die heenweg-terugweg niet, dan krijgt de bezoeker een 404
   op een URL die wél in de sitemap staat — de duurste fout die deze laag kan
   maken. Vandaar rondrit-tests over élke combinatie, niet over een steekproef. */

test("elk segment vertaalt heen en weer terug naar zichzelf", () => {
  for (const locale of VREEMD) {
    for (const nlSeg of Object.keys(SEGMENTS)) {
      const nlPad = `/${nlSeg}`;
      const vertaald = vertaalPad(nlPad, locale);
      assert.equal(ontvertaalPad(vertaald, locale), nlPad, `${nlSeg} @ ${locale} (via ${vertaald})`);
    }
  }
});

test("elke slug vertaalt heen en weer terug naar zichzelf", () => {
  for (const locale of VREEMD) {
    for (const [nlSeg, slugs] of Object.entries(SLUGS)) {
      for (const nlSlug of Object.keys(slugs)) {
        const nlPad = `/${nlSeg}/${nlSlug}`;
        const vertaald = vertaalPad(nlPad, locale);
        assert.equal(ontvertaalPad(vertaald, locale), nlPad, `${nlPad} @ ${locale} (via ${vertaald})`);
      }
    }
  }
});

test("elke locale heeft een vertaling voor élk segment en élke slug", () => {
  for (const locale of VREEMD) {
    for (const [nlSeg, tr] of Object.entries(SEGMENTS)) {
      assert.ok(tr[locale], `segment ${nlSeg} mist ${locale}`);
    }
    for (const [nlSeg, slugs] of Object.entries(SLUGS)) {
      for (const [nlSlug, tr] of Object.entries(slugs)) {
        assert.ok(tr[locale], `slug ${nlSeg}/${nlSlug} mist ${locale}`);
      }
    }
  }
});

test("geen twee Nederlandse woorden vertalen naar hetzelfde woord", () => {
  for (const locale of VREEMD) {
    const gezien = new Map();
    for (const [nl, tr] of Object.entries(SEGMENTS)) {
      const w = tr[locale];
      assert.ok(!gezien.has(w), `segment-botsing @ ${locale}: ${nl} en ${gezien.get(w)} → ${w}`);
      gezien.set(w, nl);
    }
    for (const [seg, slugs] of Object.entries(SLUGS)) {
      const perRoute = new Map();
      for (const [nl, tr] of Object.entries(slugs)) {
        const w = tr[locale];
        assert.ok(!perRoute.has(w), `slug-botsing @ ${locale} in ${seg}: ${nl} en ${perRoute.get(w)} → ${w}`);
        perRoute.set(w, nl);
      }
    }
  }
});

test("nl verandert nooit — bestaande Nederlandse URL's blijven exact gelijk", () => {
  for (const pad of ["/", "/categorie/pakken", "/products/smoking-overhemd", "/blog/iets", "/afrekenen"]) {
    assert.equal(vertaalPad(pad, "nl"), pad);
    assert.equal(ontvertaalPad(pad, "nl"), pad);
    assert.equal(publiekPad(pad, "nl"), pad);
  }
});

test("transactionele paden blijven onvertaald in élke taal", () => {
  for (const locale of VREEMD) {
    for (const pad of ["/afrekenen", "/winkelwagen", "/account", "/favorieten", "/zoeken", "/bestelling/123", "/review/123"]) {
      assert.equal(vertaalPad(pad, locale), pad, `${pad} @ ${locale} mag niet vertaald worden`);
    }
  }
});

test("handles blijven ongemoeid, alleen het segment vertaalt", () => {
  assert.equal(vertaalPad("/products/smoking-overhemd-structuur-studs", "de"), "/produkte/smoking-overhemd-structuur-studs");
  assert.equal(ontvertaalPad("/produkte/smoking-overhemd-structuur-studs", "de"), "/products/smoking-overhemd-structuur-studs");
  assert.equal(vertaalPad("/collections/nieuwe-collectie-gents", "es"), "/colecciones/nieuwe-collectie-gents");
});

test("de concrete gevallen uit de sitemap", () => {
  assert.equal(publiekPad("/categorie/pakken", "en"), "/en/category/suits");
  assert.equal(publiekPad("/categorie/pakken", "de"), "/de/kategorie/anzuege");
  assert.equal(publiekPad("/categorie/overhemden", "fr"), "/fr/categorie/chemises");
  assert.equal(publiekPad("/maattabellen/poloshirts", "es"), "/es/guia-de-tallas/polos");
  assert.equal(publiekPad("/", "de"), "/de");
  assert.equal(publiekPad("/blog", "en"), "/en/blog");
});

test("een al-Nederlands pad onder een vreemde locale is herkenbaar als niet-canoniek", () => {
  // Dit is precies wat de middleware moet zien om 301 te doen:
  // /en/categorie/pakken → nl /categorie/pakken → en /category/suits ≠ origineel.
  const binnengekomen = "/categorie/pakken";
  const nl = ontvertaalPad(binnengekomen, "en");
  assert.equal(nl, "/categorie/pakken");
  assert.notEqual(vertaalPad(nl, "en"), binnengekomen);
});

test("onbekende paden gaan er ongeschonden doorheen", () => {
  for (const locale of VREEMD) {
    for (const pad of ["/iets-onbekends", "/pages/winkels", "/looks/zomer", "/blog/post-1"]) {
      const heen = vertaalPad(pad, locale);
      assert.equal(ontvertaalPad(heen, locale), pad, `${pad} @ ${locale}`);
    }
  }
});

test("dubbel vertalen verandert niets meer (idempotent)", () => {
  for (const locale of VREEMD) {
    const een = vertaalPad("/categorie/pakken", locale);
    assert.equal(vertaalPad(ontvertaalPad(een, locale), locale), een);
  }
});

/* De hrefs zelf: hier zat het lek waardoor de anderstalige site voor Google
   één niveau diep was. Elke uitzondering hieronder is een categorie links die
   NIET geprefixt mag worden — één te veel en er ontstaat een kapotte link. */

test("interne links krijgen prefix én vertaling", () => {
  assert.equal(lokaliseerHref("/categorie/pakken", "en"), "/en/category/suits");
  assert.equal(lokaliseerHref("/products/abc", "de"), "/de/produkte/abc");
  assert.equal(lokaliseerHref("/", "fr"), "/fr");
  assert.equal(lokaliseerHref("/blog", "es"), "/es/blog");
});

test("query en anker blijven achter het pad staan", () => {
  assert.equal(lokaliseerHref("/categorie/pakken?page=2", "en"), "/en/category/suits?page=2");
  assert.equal(lokaliseerHref("/categorie/pakken#top", "de"), "/de/kategorie/anzuege#top");
  assert.equal(lokaliseerHref("/zoeken?q=pak", "en"), "/en/zoeken?q=pak");
});

test("wat met rust gelaten moet worden, blijft met rust", () => {
  for (const locale of VREEMD) {
    for (const href of [
      "https://gents.nl/iets", "//cdn.example.com/x", "mailto:info@gents.nl",
      "tel:+31612345678", "#contact-zakelijk", "/api/track",
    ]) {
      assert.equal(lokaliseerHref(href, locale), href, `${href} @ ${locale}`);
    }
  }
});

test("een href die al een locale-prefix draagt wordt niet nóg eens geprefixt", () => {
  assert.equal(lokaliseerHref("/en/category/suits", "en"), "/en/category/suits");
  assert.equal(lokaliseerHref("/de/kategorie/anzuege", "en"), "/de/kategorie/anzuege");
  assert.equal(lokaliseerHref("/nl/categorie/pakken", "en"), "/nl/categorie/pakken");
});

test("in het Nederlands verandert er niets aan de hrefs", () => {
  for (const href of ["/categorie/pakken", "/", "/products/abc?x=1"]) {
    assert.equal(lokaliseerHref(href, "nl"), href);
  }
});

test("niet-string hrefs (UrlObject) gaan ongemoeid door", () => {
  const obj = { pathname: "/categorie/pakken" };
  assert.equal(lokaliseerHref(obj, "en"), obj);
});
