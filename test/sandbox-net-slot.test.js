/**
 * Het netwerkslot is de enige echte grens tussen de sandbox en de buitenwereld.
 * Gaat hier iets stuk, dan mailt een "veilige" testomgeving echte klanten of
 * boekt hij een echte bon in SRS. Deze test bewaakt de vier beslissingen die
 * het slot mag nemen — doorlaten, omleiden, nabootsen, blokkeren — plus de
 * weigering om met echte sleutels te starten.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const OORSPRONKELIJKE_FETCH = globalThis.fetch;
const OORSPRONKELIJKE_ENV = { ...process.env };

let teller = 0;

/**
 * Verse kopie van het slot. Nodig omdat de module onthoudt dat hij al
 * geïnstalleerd is; zonder cache-omzeiling test je in elke test dezelfde
 * instantie met de env van de eerste.
 */
async function versSlot(env = {}) {
  globalThis.fetch = OORSPRONKELIJKE_FETCH;
  for (const sleutel of Object.keys(process.env)) {
    if (!(sleutel in OORSPRONKELIJKE_ENV)) delete process.env[sleutel];
  }
  Object.assign(process.env, OORSPRONKELIJKE_ENV, env);

  const doorgelaten = [];
  globalThis.fetch = async (input) => {
    doorgelaten.push(String(input?.url || input));
    return new Response('doorgelaten', { status: 200 });
  };

  const mod = await import(`../lib/sandbox/net-slot.js?t=${++teller}`);
  const actief = mod.installeerNetSlot();
  return { actief, doorgelaten };
}

test.afterEach(() => {
  globalThis.fetch = OORSPRONKELIJKE_FETCH;
  for (const sleutel of Object.keys(process.env)) {
    if (!(sleutel in OORSPRONKELIJKE_ENV)) delete process.env[sleutel];
  }
  Object.assign(process.env, OORSPRONKELIJKE_ENV);
});

test('buiten de sandbox verandert er niets aan fetch', async () => {
  const { actief, doorgelaten } = await versSlot({ GENTS_SANDBOX: '0' });
  assert.equal(actief, false, 'het slot hoort niet te installeren zonder GENTS_SANDBOX=1');

  await globalThis.fetch('https://ws.srs.nl/messages/v1/soap/Stock.php');
  assert.deepEqual(doorgelaten, ['https://ws.srs.nl/messages/v1/soap/Stock.php'],
    'productie moet ongemoeid blijven — geen onderschepping, geen omleiding');
});

test('sandbox met een ECHTE sleutel weigert te starten', async () => {
  await assert.rejects(
    () => versSlot({ GENTS_SANDBOX: '1', RESEND_API_KEY: 're_echte_sleutel_uit_productie' }),
    /RESEND_API_KEY/,
    'een echte sleutel in de sandbox hoort de boel hard te laten falen'
  );
});

test('sandbox met nep-sleutels start wel', async () => {
  const { actief } = await versSlot({
    GENTS_SANDBOX: '1',
    RESEND_API_KEY: 'sandbox-resend',
    SRS_MESSAGE_PASSWORD: 'sandbox-srs',
    MOLLIE_API_KEY: 'sandbox-mollie',
  });
  assert.equal(actief, true);
});

test('onbekende host wordt geblokkeerd, niet stilzwijgend doorgelaten', async () => {
  const { doorgelaten } = await versSlot({ GENTS_SANDBOX: '1' });

  await assert.rejects(
    () => globalThis.fetch('https://een-nieuwe-koppeling.example.com/v1/push', { method: 'POST', body: '{}' }),
    (fout) => {
      assert.equal(fout.name, 'SandboxBlokkade');
      assert.match(fout.message, /een-nieuwe-koppeling\.example\.com/);
      assert.match(fout.message, /nog niet nagebootst/, 'de melding moet vertellen wat te doen');
      return true;
    }
  );
  assert.deepEqual(doorgelaten, [], 'er mag niets naar buiten zijn gegaan');
});

test('eigen infrastructuur mag er gewoon door', async () => {
  const { doorgelaten } = await versSlot({ GENTS_SANDBOX: '1' });

  await globalThis.fetch('https://abc123.public.blob.vercel-storage.com/sandbox/postvak.json');
  await globalThis.fetch('https://ep-koel-1234.eu-central-1.aws.neon.tech/sql');

  assert.equal(doorgelaten.length, 2, 'blob en Neon zijn de opslag van de sandbox zelf');
});

test('onze eigen productie-hosts worden omgeleid naar hun sandbox-tegenhanger', async () => {
  const { doorgelaten } = await versSlot({
    GENTS_SANDBOX: '1',
    SANDBOX_SITE_URL: 'https://sandbox-site.vercel.app',
    SANDBOX_PORTAL_URL: 'https://sandbox-portal.vercel.app',
  });

  await globalThis.fetch('https://gents.nl/api/core/pos-pin', { method: 'POST', body: '{"a":1}' });
  await globalThis.fetch('https://portal.gents.nl/api/store/pos-sale');

  assert.deepEqual(doorgelaten, [
    'https://sandbox-site.vercel.app/api/core/pos-pin',
    'https://sandbox-portal.vercel.app/api/store/pos-sale',
  ], 'pad en query moeten behouden blijven, alleen de host verandert');
});

test('zonder ingestelde tegenhanger wordt gents.nl geblokkeerd in plaats van doorgelaten', async () => {
  const { doorgelaten } = await versSlot({ GENTS_SANDBOX: '1' });
  /* Dit is de belangrijkste val: vergeet je SANDBOX_SITE_URL, dan mag de
     sandbox NIET terugvallen op de echte gents.nl. */
  await assert.rejects(() => globalThis.fetch('https://gents.nl/api/core/pos-pin'), /SandboxBlokkade|geblokkeerd/);
  assert.deepEqual(doorgelaten, []);
});

test('een externe partij krijgt een nep-antwoord zonder het netwerk op te gaan', async () => {
  const { doorgelaten } = await versSlot({ GENTS_SANDBOX: '1' });

  const antwoord = await globalThis.fetch('https://api.mollie.com/v2/terminals');
  assert.equal(antwoord.status, 200);
  assert.equal(antwoord.headers.get('x-gents-sandbox'), 'mollie');

  const body = await antwoord.json();
  assert.equal(body._embedded.terminals[0].id, 'term_sandbox');
  assert.deepEqual(doorgelaten, [], 'Mollie mag nooit echt aangeroepen worden');
});

test('uitgeschakelde koppelingen zwijgen netjes met 503', async () => {
  const { doorgelaten } = await versSlot({ GENTS_SANDBOX: '1' });

  const antwoord = await globalThis.fetch('https://api-gw.dhlparcel.nl/labels', { method: 'POST', body: '{}' });
  assert.equal(antwoord.status, 503, 'best-effort koppelingen horen een net antwoord te krijgen, geen crash');
  assert.deepEqual(doorgelaten, []);
});

/**
 * Op de website hangt de HELE dekking aan één bestand: instrumentation.ts laadt
 * het slot bij het opstarten van elk serverproces. Verdwijnt die import, dan
 * merkt niemand dat — tot een sandbox-bestelling een echte mail stuurt. Vandaar
 * deze test op het bestaan ervan.
 */
test('instrumentation.ts laadt het netwerkslot', async () => {
  const { readFileSync } = await import('node:fs');
  const inhoud = readFileSync(new URL('../instrumentation.ts', import.meta.url), 'utf8');
  assert.match(inhoud, /lib\/sandbox\/index\.js/,
    'instrumentation.ts is de enige plek waar de website het slot laadt');
  assert.match(inhoud, /NEXT_RUNTIME/,
    'alleen de Node-runtime: de nep-diensten gebruiken Vercel Blob, dat draait niet op de edge');
});
