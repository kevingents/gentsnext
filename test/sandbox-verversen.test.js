/**
 * De nachtelijke verversing overschrijft een hele database. Twee dingen kunnen
 * hier grondig misgaan, en allebei stilletjes:
 *
 *  1. De verkeerde branch als doel — dan herstel je PRODUCTIE vanuit de
 *     sandbox en ben je jaren aan gegevens kwijt.
 *  2. Een tabel die niet geanonimiseerd wordt — dan staan er echte
 *     klantgegevens in een omgeving waarvan iedereen aanneemt dat hij schoon is.
 *
 * Test 2 is bewust structureel: hij leest het schema en eist dat élke tabel met
 * persoonsgegevens ook in het anonimiseer-bestand voorkomt. Voegt iemand over
 * een half jaar een tabel met een e-mailkolom toe, dan valt deze test om — en
 * dat is precies het moment waarop je het wilt weten.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { weigering } from '../lib/sandbox-verversen-regels.js';

const GOED = {
  sandboxAan: true,
  apiKey: 'napi_sleutel',
  projectId: 'proj-123',
  doel: 'br-sandbox',
  bron: 'br-productie',
  branch: { id: 'br-sandbox', name: 'sandbox', parent_id: 'br-productie', default: false },
};

test('een correct opgezette sandbox-branch mag ververst worden', () => {
  assert.equal(weigering(GOED), null);
});

test('buiten de sandbox gebeurt er niets', () => {
  assert.match(weigering({ ...GOED, sandboxAan: false }), /niet in sandbox-stand/);
});

test('ontbrekende instellingen leiden tot weigering, niet tot een gok', () => {
  for (const leeg of ['apiKey', 'projectId', 'doel', 'bron']) {
    assert.match(weigering({ ...GOED, [leeg]: '' }), /moeten alle vier gevuld zijn/, `${leeg} leeg`);
  }
});

test('doel en bron gelijk = weigeren', () => {
  assert.match(
    weigering({ ...GOED, doel: 'br-productie', branch: { ...GOED.branch, id: 'br-productie' } }),
    /hetzelfde ingesteld/
  );
});

test('de standaard-branch (productie) wordt nooit overschreven', () => {
  const productieAlsDoel = {
    ...GOED,
    doel: 'br-productie',
    bron: 'br-sandbox',
    branch: { id: 'br-productie', name: 'main', parent_id: null, default: true },
  };
  const uitslag = weigering(productieAlsDoel);
  assert.match(uitslag, /STANDAARD-branch/);
  assert.match(uitslag, /omgekeerd/, 'de melding moet de waarschijnlijke oorzaak noemen');
});

test('omgedraaide id\'s kunnen de ouder-kind-eis per definitie niet halen', () => {
  /* Dit is de sluitende controle. Zelfs als productie om wat voor reden dan ook
     niet als standaard-branch gemarkeerd zou staan, is een ouder nooit het kind
     van zijn eigen kind — dus blijft omdraaien onmogelijk. */
  const omgedraaid = {
    ...GOED,
    doel: 'br-productie',
    bron: 'br-sandbox',
    branch: { id: 'br-productie', name: 'main', parent_id: null, default: false },
  };
  assert.match(weigering(omgedraaid), /geen kind van br-sandbox/);
});

test('een branch met een andere ouder wordt geweigerd', () => {
  const vreemde = { ...GOED, branch: { ...GOED.branch, parent_id: 'br-iets-anders' } };
  assert.match(weigering(vreemde), /geen kind van br-productie/);
});

test('een antwoord dat niet over de gevraagde branch gaat wordt geweigerd', () => {
  const verkeerd = { ...GOED, branch: { ...GOED.branch, id: 'br-heel-iets-anders' } };
  assert.match(weigering(verkeerd), /geen gegevens terug/);
});

/* ── Dekking van de anonimisatie ─────────────────────────────────────────── */

/** Tabellen uit db/schema.ts die kolommen met persoonsgegevens hebben. */
function tabellenMetPersoonsgegevens() {
  const lines = readFileSync(new URL('../db/schema.ts', import.meta.url), 'utf8').split('\n');
  const pii = /^(email|phone|firstName|lastName|name|customerName|street|houseNumber|postalCode|city|recipientEmail|recipientName|senderName|klantEmail|klantNaam|naam|passwordHash|accessToken|pushToken|tokenHash)$/;

  let huidig = null;
  const tabelNaam = {};
  const treffers = new Set();

  for (const r of lines) {
    const m = r.match(/export const (\w+) = pgTable\(\s*$/) || r.match(/export const (\w+) = pgTable\("([a-z_]+)"/);
    if (m) { huidig = m[1]; if (m[2]) tabelNaam[huidig] = m[2]; continue; }
    if (!huidig) continue;

    // regel direct ná `pgTable(` bevat de tabelnaam
    const n = r.match(/^\s+"([a-z_]+)",\s*$/);
    if (n && !tabelNaam[huidig]) { tabelNaam[huidig] = n[1]; continue; }

    const c = r.match(/^\s+(\w+):\s*(?:text|varchar)\(/);
    if (c && pii.test(c[1]) && tabelNaam[huidig]) treffers.add(tabelNaam[huidig]);
  }
  return [...treffers];
}

test('elke tabel met persoonsgegevens komt voor in het anonimiseer-bestand', () => {
  const scrub = readFileSync(new URL('../lib/sandbox-anonimiseren.ts', import.meta.url), 'utf8');
  const tabellen = tabellenMetPersoonsgegevens();

  assert.ok(tabellen.length > 10, `verwacht een flink aantal tabellen, kreeg er ${tabellen.length}`);

  const vergeten = tabellen.filter((t) => !new RegExp(`\\b${t}\\b`).test(scrub));
  assert.deepEqual(
    vergeten,
    [],
    `Deze tabellen bevatten persoonsgegevens maar worden niet genoemd in lib/sandbox-anonimiseren.ts: ${vergeten.join(', ')}. ` +
    'Voeg ze toe, anders staan er na de nachtelijke verversing echte klantgegevens in de sandbox.'
  );
});

test('sessies en pushtokens worden verwijderd, niet gemaskeerd', () => {
  /* Maskeren is hier niet genoeg: dit zijn geen gegevens maar sleutels. Een
     geldige magic-link uit de kopie zou in de sandbox gewoon werken. */
  const scrub = readFileSync(new URL('../lib/sandbox-anonimiseren.ts', import.meta.url), 'utf8');
  assert.match(scrub, /DELETE FROM customer_sessions/);
  assert.match(scrub, /DELETE FROM wallet_apple_registrations/);
});

test('de order-toegangstoken wordt vervangen', () => {
  /* Met een echte access_token kun je de orderstatuspagina van een echte klant
     openen — op productie. Die mag dus niet in de kopie overblijven. */
  const scrub = readFileSync(new URL('../lib/sandbox-anonimiseren.ts', import.meta.url), 'utf8');
  assert.match(scrub, /access_token\s*=/);
});
