import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PIM_VELDEN,
  PIM_CHECK_META,
  PIM_MAX_SCORE,
  IMPORT_BESCHERMD,
  valideerVeld,
  veldVoor,
  veldLabel,
  scoreUit,
  metaSlotSleutel,
} from "../lib/pim-regels.js";

/* Het PIM mag productgegevens overschrijven die uit SRS komen. Twee dingen
   moeten dan kloppen: wat een geldige waarde is, en dat de import de
   vergrendelde velden echt met rust laat. Dat tweede was jarenlang kapot —
   `handmatige_velden` bestond wel maar werd nergens gelezen — dus daar staat
   hieronder een bewaker op. */

test("status accepteert alleen de drie bekende waarden", () => {
  for (const goed of ["active", "draft", "archived"]) {
    assert.deepEqual(valideerVeld("status", goed), { ok: true, waarde: goed });
  }
  for (const fout of ["Active", "gepubliceerd", "", "actief"]) {
    assert.equal(valideerVeld("status", fout).ok, false, `"${fout}" had geweigerd moeten worden`);
  }
});

test("de titel mag niet leeg zijn, de rest wel", () => {
  assert.equal(valideerVeld("title", "   ").ok, false);
  assert.equal(valideerVeld("title", "Colbert marine").ok, true);
  /* Leegmaken is een geldige bewerking: "deze verrijking klopte niet". */
  assert.deepEqual(valideerVeld("vendor", ""), { ok: true, waarde: "" });
  assert.deepEqual(valideerVeld("variantColorLabel", ""), { ok: true, waarde: "" });
});

test("waarden worden afgekapt op de maximale lengte en getrimd", () => {
  const veld = veldVoor("vendor");
  const lang = "x".repeat(veld.maxLengte + 50);
  const r = valideerVeld("vendor", lang);
  assert.equal(r.ok, true);
  assert.equal(r.waarde.length, veld.maxLengte);
  assert.deepEqual(valideerVeld("vendor", "  Cavallaro  "), { ok: true, waarde: "Cavallaro" });
});

test("een onbekend veld komt er niet doorheen", () => {
  for (const veld of ["price_cents", "handle", "id", "__proto__"]) {
    assert.equal(valideerVeld(veld, "wat dan ook").ok, false, `${veld} had geweigerd moeten worden`);
  }
});

test("de score telt de gewichten, niet het aantal checks", () => {
  const alles = Object.fromEntries(PIM_CHECK_META.map((c) => [c.sleutel, true]));
  assert.equal(scoreUit(alles), 100);
  assert.equal(scoreUit({}), 0);
  assert.equal(scoreUit(null), 0);

  /* Eén essentiële check (gewicht 3) weegt zwaarder dan één verrijking (1). */
  const zonderFoto = { ...alles, foto: false };
  const zonderPasvorm = { ...alles, pasvorm: false };
  assert.ok(scoreUit(zonderFoto) < scoreUit(zonderPasvorm));
  assert.equal(scoreUit(zonderFoto), Math.round((100 * (PIM_MAX_SCORE - 3)) / PIM_MAX_SCORE));
});

test("check-sleutels zijn uniek en hebben een uitleg", () => {
  const sleutels = PIM_CHECK_META.map((c) => c.sleutel);
  assert.equal(new Set(sleutels).size, sleutels.length, "dubbele check-sleutel");
  for (const c of PIM_CHECK_META) {
    assert.ok(c.uitleg && c.uitleg.length > 20, `check ${c.sleutel} heeft geen bruikbare uitleg`);
    assert.ok([1, 2, 3].includes(c.gewicht), `check ${c.sleutel} heeft gewicht ${c.gewicht}`);
  }
});

test("veldLabel vertaalt kolommen, metavelden en de override-laag", () => {
  assert.equal(veldLabel("status"), "Status");
  assert.equal(veldLabel(metaSlotSleutel("pasvorm")), "Metaveld · pasvorm");
  assert.equal(veldLabel("seo:title"), "SEO-titel");
  assert.equal(veldLabel("override:descriptionHtml"), "Omschrijving (eigen tekst)");
  /* Onbekend blijft leesbaar in plaats van "undefined" in het logboek. */
  assert.equal(veldLabel("iets_nieuws"), "iets_nieuws");
});

test("alleen bulk-velden zijn als bulk gemarkeerd, en titel hoort daar niet bij", () => {
  assert.equal(veldVoor("title").bulk, false, "een titel in bulk zetten maakt van elk artikel hetzelfde artikel");
  assert.equal(veldVoor("variantColorLabel").bulk, false);
  assert.ok(PIM_VELDEN.some((v) => v.bulk), "er moet iets in bulk kunnen");
});

/* ── De bewaker ─────────────────────────────────────────────────────────────
   Deze test leest de import zelf. Dat is ongebruikelijk, maar het gat dat we
   hiermee dichten was ook ongebruikelijk: de kolom `handmatige_velden` bestond,
   het scherm toonde er een badge bij, en géén enkele importregel keek ernaar.
   Een bewerking hield het dus precies tot de volgende import vol. Een unit-test
   op de logica zou dat niet gevangen hebben — het ontbrak juist buiten de
   logica. ───────────────────────────────────────────────────────────────── */

test("de SRS-import laat elk vergrendeld veld met rust", () => {
  const bron = readFileSync(new URL("../lib/catalog-import.ts", import.meta.url), "utf8");
  for (const { sleutel, kolom } of IMPORT_BESCHERMD) {
    assert.ok(
      bron.includes(`veilig("${sleutel}", "${kolom}"`),
      `lib/catalog-import.ts beschermt "${sleutel}" (kolom ${kolom}) niet — een bewerking van dit veld overleeft de eerstvolgende import niet`,
    );
  }
  /* En de metavelden, die via de jsonb-kolom gaan. */
  assert.ok(
    bron.includes("pim_vergrendelde_attrs"),
    "lib/catalog-import.ts legt de vergrendelde metavelden niet terug na de import",
  );
});

test("elke check heeft een SQL-conditie in lib/pim.ts", () => {
  const bron = readFileSync(new URL("../lib/pim.ts", import.meta.url), "utf8");
  const blok = bron.slice(bron.indexOf("const PIM_CHECK_SQL"), bron.indexOf("/** Meta + SQL"));
  assert.ok(blok.length > 100, "PIM_CHECK_SQL niet gevonden in lib/pim.ts");
  for (const c of PIM_CHECK_META) {
    assert.ok(
      new RegExp(`(^|\\s)${c.sleutel}:`, "m").test(blok),
      `check "${c.sleutel}" staat in de meta maar heeft geen SQL-conditie`,
    );
  }
});

test("elk bewerkbaar veld heeft een bestaande kolomnaam-vorm (snake_case)", () => {
  for (const v of PIM_VELDEN) {
    assert.match(v.kolom, /^[a-z][a-z0-9_]*$/, `kolom "${v.kolom}" ziet er niet uit als een postgres-kolom`);
    assert.ok(v.maxLengte > 0 && v.maxLengte <= 8000, `${v.sleutel} heeft een rare maxLengte`);
  }
});
