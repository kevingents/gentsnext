import test from "node:test";
import assert from "node:assert/strict";
import { bucketVoor, variantVoorBucket, doetMee, pastBijPagina, schoonExperimentsDoc, benodigdeSteekproef, oordeelKlaar } from "../lib/ab-regels.js";

/* De toewijzing bepaalt wie welke variant ziet — fouten hier vertekenen elke
   testuitslag zonder dat iemand het merkt. Vandaar tests op de wiskunde. */

test("zelfde bezoeker + zelfde experiment = altijd dezelfde bucket", () => {
  for (const wie of ["a1b2c3", "visitor-x", ""]) {
    assert.equal(bucketVoor(wie, "hero-test"), bucketVoor(wie, "hero-test"));
  }
});

test("buckets liggen in 0-99 en verdelen redelijk uniform", () => {
  const telling = new Array(10).fill(0);
  for (let i = 0; i < 10000; i++) {
    const b = bucketVoor(`bezoeker-${i}`, "exp");
    assert.ok(b >= 0 && b < 100);
    telling[Math.floor(b / 10)]++;
  }
  // Elke deciel hoort ~1000 te krijgen; ±25% is ruim genoeg om scheefheid te vangen.
  for (const n of telling) assert.ok(n > 750 && n < 1250, `deciel met ${n} van de 10000`);
});

test("verschillende experimenten verdelen onafhankelijk", () => {
  // Wie in experiment 1 in de lage buckets zit, mag niet systematisch ook in
  // experiment 2 laag zitten. Meet de overlap: rond de 50% is onafhankelijk.
  let beide = 0;
  const n = 4000;
  for (let i = 0; i < n; i++) {
    const laag1 = bucketVoor(`v${i}`, "exp-een") < 50;
    const laag2 = bucketVoor(`v${i}`, "exp-twee") < 50;
    if (laag1 === laag2) beide++;
  }
  assert.ok(beide > n * 0.45 && beide < n * 0.55, `overlap ${beide}/${n}`);
});

test("gewichten 90/10 geven ongeveer die verhouding", () => {
  const exp = { varianten: [{ key: "A", gewicht: 90 }, { key: "B", gewicht: 10 }] };
  let b = 0;
  for (let i = 0; i < 10000; i++) {
    if (variantVoorBucket(exp, bucketVoor(`v${i}`, "x")).key === "B") b++;
  }
  assert.ok(b > 700 && b < 1300, `B kreeg ${b} van de 10000`);
});

test("gewichten hoeven niet op 100 uit te komen (3/1 = 75/25)", () => {
  const exp = { varianten: [{ key: "A", gewicht: 3 }, { key: "B", gewicht: 1 }] };
  assert.equal(variantVoorBucket(exp, 0).key, "A");
  assert.equal(variantVoorBucket(exp, 74).key, "A");
  assert.equal(variantVoorBucket(exp, 75).key, "B");
  assert.equal(variantVoorBucket(exp, 99).key, "B");
});

test("targeting: land en regio filteren, onbekend land doet niet mee", () => {
  const exp = { status: "actief", landen: ["NL"], varianten: [] };
  assert.equal(doetMee(exp, "NL", ""), true);
  assert.equal(doetMee(exp, "DE", ""), false);
  assert.equal(doetMee(exp, "", ""), false); // geo onbekend → buiten de test

  const metRegio = { status: "actief", landen: ["NL"], regios: ["NB"], varianten: [] };
  assert.equal(doetMee(metRegio, "NL", "NB"), true);
  assert.equal(doetMee(metRegio, "NL", "ZH"), false);

  assert.equal(doetMee({ status: "concept", varianten: [] }, "NL", ""), false);
  assert.equal(doetMee({ status: "gestopt", varianten: [] }, "NL", ""), false);
});

test("sanering: javascript-URL's en onzin overleven het niet", () => {
  const { experimenten } = schoonExperimentsDoc({
    experimenten: [
      {
        id: "Hero Test!",
        naam: "Hero",
        status: "actief",
        landen: ["nl", "XX!", "Duitsland"],
        varianten: [
          { key: "a", gewicht: 90 },
          {
            key: "b",
            gewicht: 10,
            overrides: {
              hero: { title: "Nieuw", primaryHref: "javascript:alert(1)" },
              announcement: { text: "Balk", linkHref: "https://gents.nl/x" },
            },
          },
        ],
      },
    ],
  });
  assert.equal(experimenten.length, 1);
  const e = experimenten[0];
  assert.equal(e.id, "hero-test");
  assert.deepEqual(e.landen, ["NL"]);
  assert.equal(e.varianten[1].overrides.hero.primaryHref, undefined);
  assert.equal(e.varianten[1].overrides.announcement.linkHref, "https://gents.nl/x");
});

test("sanering: één variant is geen experiment; alle gewichten 0 krijgt een vangnet", () => {
  const { experimenten } = schoonExperimentsDoc({
    experimenten: [
      { id: "half", varianten: [{ key: "A", gewicht: 100 }] },
      { id: "nul", varianten: [{ key: "A", gewicht: 0 }, { key: "B", gewicht: 0 }] },
    ],
  });
  assert.equal(experimenten.length, 1);
  assert.equal(experimenten[0].id, "nul");
  assert.equal(experimenten[0].varianten[0].gewicht, 100);
});

test("doel: geldige waarde blijft, onzin wordt purchase", () => {
  const { experimenten } = schoonExperimentsDoc({
    experimenten: [
      { id: "een", doel: "add_to_cart", varianten: [{ key: "A", gewicht: 1 }, { key: "B", gewicht: 1 }] },
      { id: "twee", doel: "verkoop!!", varianten: [{ key: "A", gewicht: 1 }, { key: "B", gewicht: 1 }] },
    ],
  });
  assert.equal(experimenten[0].doel, "add_to_cart");
  assert.equal(experimenten[1].doel, "purchase");
});

test("meetvenster: alleen echte datums overleven de sanering", () => {
  const { experimenten } = schoonExperimentsDoc({
    experimenten: [
      {
        id: "venster",
        gestartOp: "2026-08-12T10:00:00.000Z",
        gestoptOp: "geen datum",
        varianten: [{ key: "A", gewicht: 1 }, { key: "B", gewicht: 1 }],
      },
    ],
  });
  assert.equal(experimenten[0].gestartOp, "2026-08-12T10:00:00.000Z");
  assert.equal(experimenten[0].gestoptOp, undefined);
});

/* ── Oppervlak, bereik en apparaat ────────────────────────────────────────
   Deze regels bepalen wie er in de NOEMER van de uitslag komt. Een pdp-test
   die op de homepage meetelt verdunt zichzelf tot onzichtbaar, dus dit hoort
   net zo hard onder test als de bucket-wiskunde. */

test("oppervlak: een pdp-experiment doet alleen op een productpagina mee", () => {
  const exp = { status: "actief", oppervlak: "pdp", varianten: [] };
  assert.equal(pastBijPagina(exp, { oppervlak: "pdp" }), true);
  assert.equal(pastBijPagina(exp, { oppervlak: "plp" }), false);
  assert.equal(pastBijPagina(exp, { oppervlak: "site" }), false);
  assert.equal(pastBijPagina(exp, undefined), false); // geen context = site
});

test("oppervlak: zonder oppervlak blijft een experiment site-breed (oude documenten)", () => {
  const exp = { status: "actief", varianten: [] };
  assert.equal(pastBijPagina(exp, { oppervlak: "site" }), true);
  assert.equal(pastBijPagina(exp, undefined), true);
  assert.equal(pastBijPagina(exp, { oppervlak: "pdp" }), false);
});

test("bereik: categorie of losse handle, en beide samen is OF", () => {
  const opCategorie = { status: "actief", oppervlak: "pdp", bereik: { categorieen: ["colberts"] }, varianten: [] };
  assert.equal(pastBijPagina(opCategorie, { oppervlak: "pdp", categorieen: ["colberts"] }), true);
  assert.equal(pastBijPagina(opCategorie, { oppervlak: "pdp", categorieen: ["schoenen"] }), false);
  assert.equal(pastBijPagina(opCategorie, { oppervlak: "pdp", categorieen: [] }), false);

  const opHandle = { status: "actief", oppervlak: "pdp", bereik: { handles: ["blauw-pak"] }, varianten: [] };
  assert.equal(pastBijPagina(opHandle, { oppervlak: "pdp", handle: "blauw-pak" }), true);
  assert.equal(pastBijPagina(opHandle, { oppervlak: "pdp", handle: "grijs-pak" }), false);

  const beide = { status: "actief", oppervlak: "pdp", bereik: { categorieen: ["colberts"], handles: ["losse-das"] }, varianten: [] };
  assert.equal(pastBijPagina(beide, { oppervlak: "pdp", categorieen: ["colberts"], handle: "x" }), true);
  assert.equal(pastBijPagina(beide, { oppervlak: "pdp", categorieen: ["dassen"], handle: "losse-das" }), true);
  assert.equal(pastBijPagina(beide, { oppervlak: "pdp", categorieen: ["dassen"], handle: "andere-das" }), false);
});

test("apparaat: onbekend apparaat doet niet mee aan een apparaat-gerichte test", () => {
  const mobiel = { status: "actief", oppervlak: "pdp", apparaat: "mobiel", varianten: [] };
  assert.equal(pastBijPagina(mobiel, { oppervlak: "pdp", mobiel: true }), true);
  assert.equal(pastBijPagina(mobiel, { oppervlak: "pdp", mobiel: false }), false);
  assert.equal(pastBijPagina(mobiel, { oppervlak: "pdp" }), false); // onbekend → buiten de test
  const desktop = { status: "actief", oppervlak: "pdp", apparaat: "desktop", varianten: [] };
  assert.equal(pastBijPagina(desktop, { oppervlak: "pdp", mobiel: false }), true);
  assert.equal(pastBijPagina(desktop, { oppervlak: "pdp", mobiel: true }), false);
  assert.equal(pastBijPagina(desktop, { oppervlak: "pdp" }), false);
});

test("sanering: oppervlak, apparaat en bereik", () => {
  const { experimenten } = schoonExperimentsDoc({
    experimenten: [
      {
        id: "pdp-test",
        oppervlak: "pdp",
        apparaat: "mobiel",
        doel: "add_to_cart",
        bereik: { categorieen: ["Colberts", "on-zin!!"], handles: ["Blauw Pak"] },
        varianten: [{ key: "A", gewicht: 1 }, { key: "B", gewicht: 1 }],
      },
      {
        // Bereik op site-niveau heeft geen betekenis → weg ermee, en handles
        // bestaan alleen op de PDP.
        id: "site-test",
        oppervlak: "onzin",
        apparaat: "tablet",
        bereik: { categorieen: ["colberts"], handles: ["x"] },
        varianten: [{ key: "A", gewicht: 1 }, { key: "B", gewicht: 1 }],
      },
      {
        id: "plp-test",
        oppervlak: "plp",
        doel: "product_click",
        bereik: { categorieen: ["overhemden"], handles: ["mag-niet"] },
        varianten: [{ key: "A", gewicht: 1 }, { key: "B", gewicht: 1 }],
      },
    ],
  });
  const [pdp, site, plp] = experimenten;
  assert.equal(pdp.oppervlak, "pdp");
  assert.equal(pdp.apparaat, "mobiel");
  assert.deepEqual(pdp.bereik.categorieen, ["colberts", "on-zin"]);
  assert.deepEqual(pdp.bereik.handles, ["blauw-pak"]);

  assert.equal(site.oppervlak, "site");
  assert.equal(site.apparaat, "alle");
  assert.equal(site.bereik, undefined);

  assert.equal(plp.doel, "product_click");
  assert.deepEqual(plp.bereik.categorieen, ["overhemden"]);
  assert.equal(plp.bereik.handles, undefined); // alleen de PDP kent artikelen
});

test("sanering: pdp- en plp-knoppen laten alleen bekende waarden door", () => {
  const { experimenten } = schoonExperimentsDoc({
    experimenten: [
      {
        id: "knoppen",
        oppervlak: "pdp",
        varianten: [
          { key: "A", gewicht: 1 },
          {
            key: "B",
            gewicht: 1,
            overrides: {
              pdp: {
                ctaLabel: "Nu bestellen",
                stickyKoopbalk: "uit",
                socialProof: "misschien",
                galerijStart: "packshot",
                accordionsOpen: true,
                usps: ["Gratis verzending", "", "Altijd passend advies"],
              },
              plp: { sortering: "willekeurig", kolommenMobiel: 3, perPagina: 999, tegelBeeld: "model", tegelBadges: "uit" },
            },
          },
        ],
      },
    ],
  });
  const o = experimenten[0].varianten[1].overrides;
  assert.equal(o.pdp.ctaLabel, "Nu bestellen");
  assert.equal(o.pdp.stickyKoopbalk, "uit");
  assert.equal(o.pdp.socialProof, undefined); // geen aan/uit → niets zeggen
  assert.equal(o.pdp.galerijStart, "packshot");
  assert.equal(o.pdp.accordionsOpen, true);
  assert.deepEqual(o.pdp.usps, ["Gratis verzending", "Altijd passend advies"]);
  assert.equal(o.plp.sortering, undefined); // onbekende sortering telt niet
  assert.equal(o.plp.kolommenMobiel, undefined); // alleen 1 of 2
  assert.equal(o.plp.perPagina, undefined); // buiten 8-48
  assert.equal(o.plp.tegelBeeld, "model");
  assert.equal(o.plp.tegelBadges, "uit");
});

/* ── Steekproef en de rem op te vroeg stoppen ─────────────────────────────
   Dit is de rekenkant van "mag ik hier al iets uit concluderen". Fout hier =
   een uitslag die te vroeg als winnaar wordt doorgevoerd, en dat is precies
   het soort fout dat niemand opmerkt omdat de site er daarna gewoon uitziet. */

test("steekproef: bekende ordegroottes kloppen", () => {
  // 2% basis, +15% relatief (2% → 2,3%): een aankooptest van deze omvang heeft
  // tienduizenden bezoekers per kant nodig. Dat is precies waarom je bij dun
  // verkeer op winkelwagen of doorklik meet.
  const n = benodigdeSteekproef(2, 15);
  assert.ok(n > 25000 && n < 40000, `2%/+15% gaf ${n}`);
  // Groter effect = veel minder bezoekers (kwadratisch in het verschil).
  assert.ok(benodigdeSteekproef(2, 50) < n / 5);
  // Hogere basisconversie = minder bezoekers nodig bij hetzelfde relatieve effect.
  assert.ok(benodigdeSteekproef(20, 15) < benodigdeSteekproef(2, 15));
  // Onzin levert null, geen NaN dat verderop stil een drempel van 0 wordt.
  for (const [b, l] of [[0, 15], [2, 0], [-1, 10], [100, 10], ["", ""]]) {
    assert.equal(benodigdeSteekproef(b, l), null, `${b}/${l}`);
  }
});

test("oordeel: pas na de looptijd én de steekproef", () => {
  const vol = { dagenGelopen: 10, kleinsteVariant: 5000, minDagen: 7, doelPerVariant: 4000 };
  assert.equal(oordeelKlaar(vol).klaar, true);

  const teVroeg = oordeelKlaar({ ...vol, dagenGelopen: 3 });
  assert.equal(teVroeg.klaar, false);
  assert.match(teVroeg.reden, /nog 4 dagen/);

  const teWeinig = oordeelKlaar({ ...vol, kleinsteVariant: 1200 });
  assert.equal(teWeinig.klaar, false);
  assert.match(teWeinig.reden, /2800 bezoekers/);

  // Ondergrens van 100 geldt altijd, ook zonder eigen doel — anders zou een
  // experiment zonder instellingen al na één bezoeker "klaar" zijn.
  assert.equal(oordeelKlaar({ dagenGelopen: 30, kleinsteVariant: 40, minDagen: 0, doelPerVariant: 0 }).klaar, false);
  assert.equal(oordeelKlaar({ dagenGelopen: 30, kleinsteVariant: 150, minDagen: 0, doelPerVariant: 0 }).klaar, true);
});

test("sanering: looptijd, steekproefdoel en verwacht effect", () => {
  const { experimenten } = schoonExperimentsDoc({
    experimenten: [
      { id: "leeg", varianten: [{ key: "A", gewicht: 1 }, { key: "B", gewicht: 1 }] },
      {
        id: "gevuld",
        minLooptijdDagen: 14,
        doelBezoekersPerVariant: 5000,
        verwachtEffectPct: 25,
        varianten: [{ key: "A", gewicht: 1 }, { key: "B", gewicht: 1 }],
      },
      {
        id: "onzin",
        minLooptijdDagen: -5,
        doelBezoekersPerVariant: "veel",
        verwachtEffectPct: 0,
        varianten: [{ key: "A", gewicht: 1 }, { key: "B", gewicht: 1 }],
      },
    ],
  });
  const [leeg, gevuld, onzin] = experimenten;
  assert.equal(leeg.minLooptijdDagen, 7); // een volle week is de standaard
  assert.equal(leeg.doelBezoekersPerVariant, 0); // 0 = server rekent het uit
  assert.equal(leeg.verwachtEffectPct, 15);
  assert.equal(gevuld.minLooptijdDagen, 14);
  assert.equal(gevuld.doelBezoekersPerVariant, 5000);
  assert.equal(gevuld.verwachtEffectPct, 25);
  assert.equal(onzin.minLooptijdDagen, 0);
  assert.equal(onzin.doelBezoekersPerVariant, 0);
  assert.equal(onzin.verwachtEffectPct, 15);
});

test("sanering: de nieuwe pdp- en plp-knoppen", () => {
  const { experimenten } = schoonExperimentsDoc({
    experimenten: [
      {
        id: "meer-knoppen",
        oppervlak: "plp",
        varianten: [
          { key: "A", gewicht: 1 },
          {
            key: "B",
            gewicht: 1,
            overrides: {
              pdp: { reviewsPositie: "boven", kortingLabel: "uit", galerijMax: 4 },
              plp: { filterPositie: "boven", snelToevoegen: "aan" },
            },
          },
          {
            key: "C",
            gewicht: 1,
            overrides: { pdp: { reviewsPositie: "zijkant", galerijMax: 99 }, plp: { filterPositie: "onder" } },
          },
        ],
      },
    ],
  });
  const [, b, c] = experimenten[0].varianten;
  assert.equal(b.overrides.pdp.reviewsPositie, "boven");
  assert.equal(b.overrides.pdp.kortingLabel, "uit");
  assert.equal(b.overrides.pdp.galerijMax, 4);
  assert.equal(b.overrides.plp.filterPositie, "boven");
  assert.equal(b.overrides.plp.snelToevoegen, "aan");
  // Onbekende waarden vallen weg i.p.v. door te lekken naar de site.
  assert.equal(c.overrides?.pdp?.reviewsPositie, undefined);
  assert.equal(c.overrides?.pdp?.galerijMax, undefined); // buiten 1-12
  assert.equal(c.overrides?.plp, undefined);
});
