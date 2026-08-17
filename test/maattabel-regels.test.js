import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { leesCsv, leesXlsx } from "../lib/xlsx-lezen.ts";
import {
  cmBereik,
  controleerTabel,
  leesMaatblad,
  naarSizeChart,
} from "../lib/maattabel-regels.ts";
import { sizeByChest, boordByChest, CHART_CATEGORIES } from "../lib/size-chart.ts";

/* De GENTS-maatvoering stond hardgecodeerd in lib/size-chart.ts en gaat nu als
   Excel naar binnen. Die tabel bepaalt wat het maatadvies aan iedere bezoeker
   adviseert, dus twee dingen moeten kloppen: we moeten een blad correct kunnen
   LEZEN (ook als iemand het zelf in Excel heeft bijgehouden), en we moeten een
   scheef blad TEGENHOUDEN voordat het live gaat.

   De xlsx-lezer is met de hand gebouwd (een xlsx is een zip met XML, en deze
   repo houdt z'n dependencies klein), dus die verdient echte bytes om op te
   kauwen — niet een gemockte parser. Vandaar de zip-bouwer hieronder. */

/* ─────────────────────────── xlsx-fixture ─────────────────────────── */

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

/** Minimale zip-schrijver: genoeg om een geldige xlsx te maken. */
function zip(entries, { comprimeren = true } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { naam, tekst } of entries) {
    const raw = Buffer.from(tekst, "utf8");
    const data = comprimeren ? deflateRawSync(raw) : raw;
    const methode = comprimeren ? 8 : 0;
    const naamBuf = Buffer.from(naam, "utf8");
    const crc = CRC(raw);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(methode, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(naamBuf.length, 26);
    locals.push(lh, naamBuf, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(methode, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(naamBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, naamBuf);

    offset += lh.length + naamBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/**
 * Bouwt een xlsx zoals Excel het opslaat: tekstcellen als verwijzing naar de
 * gedeelde-tekstentabel (t="s"), getallen kaal. Dát is de vorm die de lezer in
 * het echt tegenkomt.
 */
function maakXlsx(rijen, { bladnaam = "Maten", extraBlad = null } = {}) {
  const strings = [];
  const idx = (s) => {
    const i = strings.indexOf(s);
    return i >= 0 ? i : strings.push(s) - 1;
  };
  const kolomLetter = (n) => {
    let s = "";
    n += 1;
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const rijXml = rijen
    .map((rij, r) => {
      const cellen = rij
        .map((cel, c) => {
          if (cel === "" || cel === null || cel === undefined) return "";
          const ref = `${kolomLetter(c)}${r + 1}`;
          if (typeof cel === "number") return `<c r="${ref}"><v>${cel}</v></c>`;
          return `<c r="${ref}" t="s"><v>${idx(String(cel))}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cellen}</row>`;
    })
    .join("");

  const sheet = `<?xml version="1.0"?><worksheet><sheetData>${rijXml}</sheetData></worksheet>`;
  const shared = `<?xml version="1.0"?><sst count="${strings.length}">${strings
    .map((s) => `<si><t>${esc(s)}</t></si>`)
    .join("")}</sst>`;

  const bladen = [{ naam: bladnaam, xml: sheet }];
  if (extraBlad) bladen.unshift(extraBlad); // toelichtingstabblad vóór de data
  const workbook = `<?xml version="1.0"?><workbook><sheets>${bladen
    .map((b, i) => `<sheet name="${esc(b.naam)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("")}</sheets></workbook>`;

  return zip([
    { naam: "[Content_Types].xml", tekst: `<?xml version="1.0"?><Types/>` },
    { naam: "xl/workbook.xml", tekst: workbook },
    { naam: "xl/sharedStrings.xml", tekst: shared },
    ...bladen.map((b, i) => ({ naam: `xl/worksheets/sheet${i + 1}.xml`, tekst: b.xml })),
  ]);
}

/* De keuring krijgt haar lijstjes mee i.p.v. ze te importeren (zie de kop van
   lib/maattabel-regels): zo blijft die module met `node --test` te draaien. */
const ctx = (catalogusMaten) => ({
  bekendeCategorieen: CHART_CATEGORIES,
  hoofdgroepen: new Map([
    ["Colberts (Standaard)", ["Colberts", "Gilets"]],
    ["Overhemden (Boordmaat)", ["Overhemden"]],
    ["Pantalon (Lang)", ["Broeken"]],
  ]),
  catalogusMaten,
});

/* ─────────────────────────── De lezer ─────────────────────────── */

test("xlsx: leest gedeelde teksten, getallen en tabbladnamen", () => {
  const buf = maakXlsx([
    ["Categorie", "Maat", "Borst", "Taille"],
    ["Colberts (Standaard)", "50", 107, 96],
  ]);
  const bladen = leesXlsx(buf);
  assert.equal(bladen.length, 1);
  assert.equal(bladen[0].naam, "Maten");
  assert.deepEqual(bladen[0].rijen[0], ["Categorie", "Maat", "Borst", "Taille"]);
  assert.deepEqual(bladen[0].rijen[1], ["Colberts (Standaard)", "50", "107", "96"]);
});

test("xlsx: een lege cel schuift de rij niet op", () => {
  // Excel slaat lege cellen niet op. Zonder plaatsing op kolomindex belandt de
  // taillemaat dan onder Borst — precies de fout die je nooit ziet in een tabel
  // die er verder normaal uitziet.
  const buf = maakXlsx([
    ["Categorie", "Maat", "Borst", "Taille"],
    ["Pantalon (Lang)", "98", "", 88],
  ]);
  const rij = leesXlsx(buf)[0].rijen[1];
  assert.deepEqual(rij, ["Pantalon (Lang)", "98", "", "88"]);
});

test("xlsx: ontsnapte tekens komen heel terug", () => {
  const buf = maakXlsx([["Maat", "Categorie"], ["M", "Polo & Trui <light>"]]);
  assert.equal(leesXlsx(buf)[0].rijen[1][1], "Polo & Trui <light>");
});

test("xlsx: ongecomprimeerde (stored) onderdelen werken ook", () => {
  const buf = zip(
    [
      { naam: "xl/workbook.xml", tekst: `<workbook><sheets><sheet name="Blad" sheetId="1"/></sheets></workbook>` },
      { naam: "xl/sharedStrings.xml", tekst: `<sst><si><t>Maat</t></si></sst>` },
      { naam: "xl/worksheets/sheet1.xml", tekst: `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>` },
    ],
    { comprimeren: false },
  );
  assert.equal(leesXlsx(buf)[0].rijen[0][0], "Maat");
});

test("xlsx: geen zip = nette fout, geen brok", () => {
  assert.throws(() => leesXlsx(Buffer.from("dit is gewoon tekst")), /geen geldig xlsx/i);
});

test("csv: puntkomma's van een Nederlandse Excel-export", () => {
  const rijen = leesCsv('Categorie;Maat;Borst\r\nColberts (Standaard);50;107\r\n');
  assert.deepEqual(rijen[1], ["Colberts (Standaard)", "50", "107"]);
});

test("csv: een veld met de scheider erin blijft één veld", () => {
  const rijen = leesCsv('Maat,Notitie\n50,"valt ruim, kies kleiner"\n');
  assert.deepEqual(rijen[1], ["50", "valt ruim, kies kleiner"]);
});

/* ─────────────────────────── cm-bereiken ─────────────────────────── */

test("cmBereik: puntwaarde blijft een puntwaarde", () => {
  // min===max is geen slordigheid maar de betekenis "exact deze maat": zo staat
  // colbert in de bron (50 = 107 cm) en zo herkent pickByRange een treffer.
  assert.deepEqual(cmBereik("107"), [107, 107]);
  assert.deepEqual(cmBereik("96-100"), [96, 100]);
  assert.deepEqual(cmBereik("96 – 100"), [96, 100]);
  assert.deepEqual(cmBereik("96 t/m 100"), [96, 100]);
  assert.deepEqual(cmBereik(""), [null, null]);
  assert.deepEqual(cmBereik("100-96"), [96, 100]); // omgekeerd ingevuld
});

/* ─────────────────────────── Inlezen van een blad ─────────────────────────── */

const NL_BLAD = [
  ["GENTS maatvoering", "", "", "", ""],
  ["Categorie", "Maat", "Borst", "Taille", "Boord"],
  ["Colberts (Standaard)", "48", "103", "92", ""],
  ["", "50", "107", "96", ""],
  ["", "52", "111", "100", ""],
  ["Overhemden (Boordmaat)", "M", "96-100", "84-88", "39-40"],
  ["", "L", "100-104", "88-92", "41-42"],
];

test("blad: koprij hoeft niet de eerste rij te zijn", () => {
  const { rijen, bevindingen } = leesMaatblad(NL_BLAD);
  assert.equal(rijen.length, 5);
  assert.equal(bevindingen.filter((b) => b.ernst === "fout").length, 0);
});

test("blad: een lege categoriecel erft de vorige categorie", () => {
  // Bladen zetten de categorie alleen bij de eerste maat. Zonder doorschuiven
  // verdwijnen maat 50 en 52 stil uit de tabel.
  const { rijen } = leesMaatblad(NL_BLAD);
  assert.deepEqual(
    rijen.filter((r) => r.categorie === "Colberts (Standaard)").map((r) => r.maat),
    ["48", "50", "52"],
  );
});

test("blad: losse min/max-kolommen werken net zo goed als één bereikkolom", () => {
  const { rijen } = leesMaatblad([
    ["Category", "Size", "Chest min", "Chest max"],
    ["Colberts (Standaard)", "50", "107", "107"],
    ["Overhemden (Boordmaat)", "M", "96", "100"],
  ]);
  assert.deepEqual([rijen[0].borstMin, rijen[0].borstMax], [107, 107]);
  assert.deepEqual([rijen[1].borstMin, rijen[1].borstMax], [96, 100]);
});

test("blad: 'borst min' wordt niet als 'borst' gelezen", () => {
  // Het langste synoniem moet eerst matchen; anders slokt de kolom "Borst" de
  // min-kolom op en verdwijnt de max.
  const { rijen } = leesMaatblad([
    ["Categorie", "Maat", "Borst min", "Borst max"],
    ["Colberts (Standaard)", "50", "104", "110"],
  ]);
  assert.deepEqual([rijen[0].borstMin, rijen[0].borstMax], [104, 110]);
});

test("blad: een rij zonder categorie wordt niet stil ingelezen", () => {
  // De tabel is per categorie ingedeeld; een maat zonder categorie kan nergens
  // aan gekoppeld worden. Beter overslaan mét melding dan gokken.
  const { rijen, bevindingen } = leesMaatblad([["Maat", "Borst"], ["50", "107"]]);
  assert.equal(rijen.length, 0);
  assert.ok(bevindingen.some((b) => b.soort === "onbekende-categorie"));
});

test("blad: rij zonder enige lichaamsmaat wordt overgeslagen, niet stil ingelezen", () => {
  const { rijen, bevindingen } = leesMaatblad([
    ["Categorie", "Maat", "Borst"],
    ["Colberts (Standaard)", "50", "107"],
    ["Colberts (Standaard)", "62", ""],
  ]);
  assert.equal(rijen.length, 1);
  assert.ok(bevindingen.some((b) => b.soort === "geen-maatgegevens" && b.maat === "62"));
});

test("blad: dubbele maat levert een melding en niet twee rijen", () => {
  const { rijen, bevindingen } = leesMaatblad([
    ["Categorie", "Maat", "Borst"],
    ["Colberts (Standaard)", "50", "107"],
    ["Colberts (Standaard)", "50", "108"],
  ]);
  assert.equal(rijen.length, 1);
  assert.ok(bevindingen.some((b) => b.soort === "dubbele-maat"));
});

test("blad: zonder maatkolom weigeren we met een fout", () => {
  const { rijen, bevindingen } = leesMaatblad([["Categorie", "Borst"], ["Colberts", "107"]]);
  assert.equal(rijen.length, 0);
  assert.equal(bevindingen[0].ernst, "fout");
});

/* ─────────────────────────── Keuren ─────────────────────────── */

const GOED = leesMaatblad(NL_BLAD).rijen;

test("keuring: een compleet blad levert geen fouten", () => {
  assert.equal(controleerTabel(GOED, ctx()).filter((b) => b.ernst === "fout").length, 0);
});

test("keuring: zonder colbertrijen mag de tabel niet live", () => {
  // Dit is de fout die het duurst is: het maatadvies geeft dan geen colbertmaat
  // meer, zonder dat er iets stuk lijkt.
  const zonder = GOED.filter((r) => r.categorie !== "Colberts (Standaard)");
  const b = controleerTabel(zonder, ctx());
  assert.ok(b.some((x) => x.ernst === "fout" && x.soort === "kerncategorie-ontbreekt"));
});

test("keuring: zonder boordmaten mag de tabel ook niet live", () => {
  const zonder = GOED.map((r) =>
    r.categorie === "Overhemden (Boordmaat)" ? { ...r, boordCm: "" } : r,
  );
  const b = controleerTabel(zonder, ctx());
  assert.ok(b.some((x) => x.ernst === "fout" && x.soort === "kerncategorie-ontbreekt"));
});

test("keuring: een gat tussen twee bereiken wordt gemeld", () => {
  const metGat = leesMaatblad([
    ["Categorie", "Maat", "Borst"],
    ["Colberts (Standaard)", "50", "107"],
    ["Overhemden (Boordmaat)", "M", "96-100"],
    ["Overhemden (Boordmaat)", "XL", "108-112"],
  ]).rijen.map((r) => (r.categorie === "Overhemden (Boordmaat)" ? { ...r, boordCm: "39-40" } : r));
  const b = controleerTabel(metGat, ctx());
  assert.ok(b.some((x) => x.soort === "gat"), "gat 101–107 hoort gemeld te worden");
});

test("keuring: puntwaarden (colbert) leveren GEEN valse gaten", () => {
  // Colbertmaten staan als puntwaarde met stappen van 4 cm. Dat is de bedoeling
  // en geen gat; anders staat het scherm vol meldingen die niemand kan oplossen
  // en kijkt niemand er meer naar.
  const b = controleerTabel(GOED, ctx()).filter((x) => x.soort === "gat" && x.categorie === "Colberts (Standaard)");
  assert.equal(b.length, 0);
});

test("keuring: overlappende bereiken worden gemeld", () => {
  const overlap = leesMaatblad([
    ["Categorie", "Maat", "Borst"],
    ["Colberts (Standaard)", "50", "107"],
    ["Overhemden (Boordmaat)", "M", "96-102"],
    ["Overhemden (Boordmaat)", "L", "100-104"],
  ]).rijen.map((r) => (r.categorie === "Overhemden (Boordmaat)" ? { ...r, boordCm: "39-40" } : r));
  assert.ok(controleerTabel(overlap, ctx()).some((x) => x.soort === "overlap"));
});

test("keuring: catalogusmaat zonder tabelrij wordt gemeld", () => {
  // De stille fout: de klant kan maat 62 kopen, maar de tabel zegt er niets over,
  // dus het maatadvies kan hem niet omrekenen.
  const catalogus = new Map([["Colberts", ["48", "50", "52", "62"]]]);
  const b = controleerTabel(GOED, ctx(catalogus));
  const melding = b.find((x) => x.soort === "catalogusmaat-zonder-rij");
  assert.ok(melding, "62 hoort gemeld te worden");
  assert.match(melding.tekst, /62/);
});

test("keuring: maten die de taxonomie niet plaatst leveren geen bevinding", () => {
  /* "20L", "26R" en "One" komen in de catalogus voor onder hoofdgroepen waar ze
     niet horen. Die als ontbrekende maat melden gaf per categorie dezelfde
     handvol onoplosbare regels — en dan kijkt niemand meer naar de rest. */
  const catalogus = new Map([["Colberts", ["48", "50", "52", "20L", "26R", "One"]]]);
  const b = controleerTabel(GOED, { ...ctx(catalogus), rijLabel: (m) => (/^\d+$/.test(m) ? "M" : m) });
  assert.equal(b.filter((x) => x.soort === "catalogusmaat-zonder-rij").length, 0);
});

test("keuring: de drie pantalon-reeksen worden niet met elkaar vergeleken", () => {
  /* "Broeken" bevat standaard- (46–64), lengte- (90–118) én kwartmaten (23–33),
     terwijl de tabel die in drie categorieën splitst. Zonder scheiding meldt
     Pantalon (Lang) alle kwartmaten als ontbrekend: 56 valse bevindingen. */
  const rijen = leesMaatblad([
    ["Categorie", "Maat", "Taille", "Boord"],
    ["Colberts (Standaard)", "50", "96", ""],
    ["Overhemden (Boordmaat)", "M", "84-88", "39-40"],
    ["Pantalon (Lang)", "98", "88", ""],
  ]).rijen;

  const basis = {
    bekendeCategorieen: CHART_CATEGORIES,
    hoofdgroepen: new Map([
      ["Colberts (Standaard)", ["Colberts"]],
      ["Overhemden (Boordmaat)", ["Overhemden"]],
      ["Pantalon (Lang)", ["Broeken"]],
    ]),
    catalogusMaten: new Map([["Broeken", ["98", "25"]]]), // lengtemaat + kwartmaat
    // 98 valt op dezelfde rij als de tabelrij, 25 (kwartmaat) op een andere.
    rijLabel: (m) => (m === "25" ? "S" : "M/L"),
  };

  const zonder = controleerTabel(rijen, basis).filter((x) => x.soort === "catalogusmaat-zonder-rij");
  const met = controleerTabel(rijen, {
    ...basis,
    maatGroep: (m) => (m === "25" ? "short" : "long"),
  }).filter((x) => x.soort === "catalogusmaat-zonder-rij");

  assert.equal(zonder.length, 1, "zonder scheiding wordt kwartmaat 25 tegen de lengtereeks aangehouden");
  assert.equal(met.length, 0, "met scheiding hoort 25 bij Pantalon (Kwart), niet bij (Lang)");
});

test("keuring: onbekende categorie is een waarschuwing, geen blokkade", () => {
  const extra = [...GOED, { ...GOED[0], categorie: "Sokken", maat: "43" }];
  const b = controleerTabel(extra, ctx());
  assert.ok(b.some((x) => x.soort === "onbekende-categorie" && x.ernst === "waarschuwing"));
  assert.equal(b.filter((x) => x.ernst === "fout").length, 0);
});

/* ─────────────────────────── Naar de site ─────────────────────────── */

test("een geüploade tabel verandert echt wat het maatadvies adviseert", () => {
  // De hele reden dat dit bestaat: nieuwe maatvoering uploaden moet de site
  // laten meebewegen. Ingebakken hoort 107 cm bij maat 50; hier bij 44.
  assert.equal(sizeByChest("Colberts (Standaard)", 107)?.size, "50");

  const eigen = naarSizeChart(
    leesMaatblad([
      ["Categorie", "Maat", "Borst", "Boord"],
      ["Colberts (Standaard)", "44", "107", ""],
      ["Colberts (Standaard)", "46", "111", ""],
      ["Overhemden (Boordmaat)", "M", "96-100", "39-40"],
      ["Overhemden (Boordmaat)", "L", "100-104", "41-42"],
    ]).rijen,
    7,
  );

  assert.equal(eigen.versie, 7);
  assert.equal(sizeByChest("Colberts (Standaard)", 107, eigen)?.size, "44");
  assert.equal(boordByChest(102, eigen)?.boordCm, "41-42");
  // En zonder tabel blijft de ingebakken waarde staan — de fallback moet werken.
  assert.equal(sizeByChest("Colberts (Standaard)", 107)?.size, "50");
});

test("boordlijst wordt afgeleid uit de overhemdenrijen", () => {
  const chart = naarSizeChart(
    leesMaatblad([
      ["Categorie", "Maat", "Borst", "Taille", "Boord"],
      ["Colberts (Standaard)", "50", "107", "96", ""],
      ["Overhemden (Boordmaat)", "M", "96-100", "84-88", "39/40"],
    ]).rijen,
    1,
  );
  assert.equal(chart.boord.length, 1);
  // "39/40" uit het blad wordt "39-40" — de site splitst op het streepje.
  assert.equal(chart.boord[0].boordCm, "39-40");
  assert.equal(chart.boord[0].confectie, "M");
});
