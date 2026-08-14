import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, leesArtikelen, centen, meestVoorkomend } from "../lib/srs-artikelen-regels.js";

/* Het SRS-productenbestand is CSV met vrije tekst erin. Eén komma in "Colbert,
   blauw" schuift bij een naïeve parser élke volgende kolom op — en dan koppel je
   artikelnummers aan de verkeerde barcodes zonder dat er iets faalt. Stille
   schade, dus tests op precies die randgevallen. */

const KOP =
  'Artikel nummer,Artikel ID,Artikel omschrijving,Hoofdgroep ID,Hoofdgroep omschrijving,' +
  'Leverancier naam,Kleur ID,Kleur omschrijving,Maat,Barcode,Verkoopprijs,' +
  'label_merk,label_seizoen,label_jaar,label_materiaal,label_samenstelling,label_pasvorm,' +
  'Artikel foto,Artikel foto 2';

test("een komma binnen aanhalingstekens schuift de kolommen niet op", () => {
  const csv = `${KOP}\n4483,COL-1,"Colbert, blauw met streep",1,Colberts,Cavallaro,07,Blauw,50,2900001,24990,Cavallaro,Herfst/Winter,2026,Wol,"100% wol, gevoerd",Slim fit,https://x/1.jpg,`;
  const [a] = leesArtikelen(csv);
  assert.equal(a.omschrijving, "Colbert, blauw met streep");
  assert.equal(a.barcode, "2900001", "de barcode is opgeschoven — dan koppel je het verkeerde artikel");
  assert.equal(a.artikelNummer, "4483");
  assert.equal(a.kleurId, "07");
  assert.equal(a.samenstelling, "100% wol, gevoerd");
  assert.equal(a.pasvorm, "Slim fit");
});

test("een regeleinde binnen aanhalingstekens breekt de rij niet op", () => {
  const csv = `${KOP}\n4484,COL-2,"Colbert\nmet nieuwe regel",1,Colberts,Cavallaro,08,Groen,52,2900002,19990,,,,,,,,`;
  const rijen = leesArtikelen(csv);
  assert.equal(rijen.length, 1, "de rij is doormidden geknipt");
  assert.equal(rijen[0].barcode, "2900002");
});

test('"" binnen een veld is één letterlijk aanhalingsteken', () => {
  const rows = parseCsv('a,"zeg ""hallo""",c');
  assert.deepEqual(rows[0], ["a", 'zeg "hallo"', "c"]);
});

test("alleen echte URL's tellen als foto", () => {
  const csv = `${KOP}\n1,X,Test,1,G,L,01,Blauw,50,2900003,100,,,,,,,https://cdn/a.jpg,geen`;
  const [a] = leesArtikelen(csv);
  assert.deepEqual(a.fotos, ["https://cdn/a.jpg"], "'geen' als src geeft een gebroken plaatje op de site");
});

test("rijen zonder barcode én zonder artikelnummer vallen af", () => {
  const csv = `${KOP}\n,,,,,,,,,,,,,,,,,,\n4485,X,Test,1,G,L,01,Blauw,50,2900004,100,,,,,,,,`;
  const rijen = leesArtikelen(csv);
  assert.equal(rijen.length, 1);
  assert.equal(rijen[0].artikelNummer, "4485");
});

test("een leeg of koploos bestand geeft een lege lijst, geen fout", () => {
  assert.deepEqual(leesArtikelen(""), []);
  assert.deepEqual(leesArtikelen(KOP), []);
});

test("prijzen komen als centen binnen, ook met opmaak", () => {
  assert.equal(centen("24990"), 24990);
  assert.equal(centen("€ 249,90"), 24990);
  assert.equal(centen(""), 0);
  assert.equal(centen("onzin"), 0);
});

test("meestVoorkomend kiest de meerderheid, niet de eerste", () => {
  /* Eén maat staat verkeerd in SRS; het artikel moet de rest volgen. */
  const paren = [
    { nr: "9999", kleur: "01" },
    { nr: "4483", kleur: "07" },
    { nr: "4483", kleur: "07" },
    { nr: "4483", kleur: "07" },
  ];
  assert.deepEqual(meestVoorkomend(paren), { nr: "4483", kleur: "07", stemmen: 3 });
});

test("meestVoorkomend is stabiel bij gelijkspel en leeg bij niets", () => {
  const a = meestVoorkomend([{ nr: "1", kleur: "a" }, { nr: "2", kleur: "b" }]);
  const b = meestVoorkomend([{ nr: "1", kleur: "a" }, { nr: "2", kleur: "b" }]);
  assert.deepEqual(a, b, "dezelfde invoer moet hetzelfde antwoord geven");
  assert.equal(meestVoorkomend([]), null);
  assert.equal(meestVoorkomend(null), null);
});

test("een ontbrekende kolom maakt het veld leeg in plaats van undefined", () => {
  /* SRS levert niet bij elke webshop-instelling alle label_-kolommen. */
  const csv = "Artikel nummer,Barcode\n4486,2900005";
  const [a] = leesArtikelen(csv);
  assert.equal(a.artikelNummer, "4486");
  assert.equal(a.barcode, "2900005");
  assert.equal(a.merk, "");
  assert.deepEqual(a.fotos, []);
});
