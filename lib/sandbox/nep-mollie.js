/**
 * lib/sandbox/nep-mollie.js — betalen en pinnen zonder geld.
 *
 * Dit is de nabootsing waar de meeste zorg in zit, want dit is de koppeling
 * waar écht geld doorheen gaat. Twee dingen zijn bewust NIET vereenvoudigd,
 * omdat je juist die twee wil kunnen testen:
 *
 *  1. IDEMPOTENTIE. De echte Mollie geeft bij dezelfde Idempotency-Key dezelfde
 *     betaling terug; daar leunt de kassa op ("één afrekenpoging = hooguit één
 *     betaling"). Een nabootsing die bij elke aanroep een nieuwe betaling maakt,
 *     zou een dubbele-afschrijving-bug netjes verbergen. Dus doen we het na.
 *  2. OVER-RETOUR. De echte Mollie weigert een terugstorting groter dan de
 *     betaling. Onze eigen begrenzing daarboven is nooit getest als de
 *     nabootsing alles goedkeurt. Dus weigert hij hier ook.
 *
 * De pinautomaat wacht echt even (`pinVertragingMs`) en gaat daarna naar de
 * uitkomst die in de regie staat — geslaagd, mislukt, afgebroken of een
 * tijdsoverschrijding. Zo test je de wachtstand van de kassa, niet alleen het
 * gelukkige pad.
 */

import { PAD, lees, muteer, leesRegie } from './state.js';

const JSON_KOP = { 'content-type': 'application/json; charset=utf-8', 'x-gents-sandbox': 'mollie' };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_KOP });
}

function foutJson(bericht, status = 422) {
  return json({ status, title: 'Sandbox', detail: bericht }, status);
}

function id(voorvoegsel) {
  return `${voorvoegsel}_sb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function centen(bedrag) {
  return Math.round(Number(bedrag?.value || 0) * 100);
}

function euro(cent) {
  return (Math.round(cent) / 100).toFixed(2);
}

/** Bewaarde betaling → het antwoordobject dat Mollie zou geven. */
function alsBetaling(b, status) {
  const uit = {
    resource: 'payment',
    id: b.id,
    mode: 'test',
    status,
    description: b.omschrijving,
    amount: { currency: 'EUR', value: euro(b.bedragCent) },
    method: b.methode,
    createdAt: b.aangemaaktOp,
    metadata: b.metadata || null,
    _links: {
      self: { href: `https://api.mollie.com/v2/payments/${b.id}`, type: 'application/hal+json' },
      checkout: { href: `https://sandbox.local/betaal/${b.id}`, type: 'text/html' },
    },
  };
  if (status === 'paid') uit.paidAt = new Date().toISOString();
  if (status === 'canceled') uit.canceledAt = new Date().toISOString();
  if (status === 'failed') uit.failedAt = new Date().toISOString();
  if (status === 'expired') uit.expiredAt = new Date().toISOString();
  if (b.terminalId) uit.terminalId = b.terminalId;
  return uit;
}

/**
 * De stand van een betaling op dít moment. Zolang de ingestelde vertraging niet
 * verstreken is blijft hij `open` — precies zoals een klant die nog met z'n pas
 * staat te klooien. Daarna volgt de uitkomst uit de regie.
 */
export function huidigeStatus(b, regie, nu = Date.now()) {
  if (b.status && b.status !== 'open') return b.status;   // handmatig geannuleerd o.i.d.
  const verstreken = nu - new Date(b.aangemaaktOp).getTime();
  const wachttijd = Number(b.pinVertragingMs ?? regie.pinVertragingMs) || 0;
  if (verstreken < wachttijd) return 'open';
  switch (b.pinUitkomst || regie.pinUitkomst) {
    case 'mislukt': return 'failed';
    case 'afgebroken': return 'canceled';
    case 'tijdsoverschrijding': return 'expired';
    default: return 'paid';
  }
}

async function maakBetaling(verzoek) {
  let body = {};
  try { body = JSON.parse(verzoek.lichaam || '{}'); } catch { body = {}; }

  const sleutel = String(verzoek.headers.get('idempotency-key') || '').trim();
  const regie = await leesRegie();

  /* Idempotentie: dezelfde sleutel = dezelfde betaling, geen tweede afschrijving. */
  if (sleutel) {
    const bestaand = (await lees(PAD.betalingen, [])).find((b) => b.idempotencySleutel === sleutel);
    if (bestaand) return json(alsBetaling(bestaand, huidigeStatus(bestaand, regie)));
  }

  const betaling = {
    id: id('tr'),
    idempotencySleutel: sleutel || null,
    bedragCent: centen(body.amount),
    omschrijving: String(body.description || ''),
    methode: body.method || null,
    terminalId: body.terminalId || null,
    metadata: body.metadata || null,
    aangemaaktOp: new Date().toISOString(),
    status: 'open',
    /* De regie op het moment van aanmaken vastleggen: zet een tester de knop
       tijdens het aftellen om, dan verandert een lopende betaling niet meer
       van uitkomst. Dat is voorspelbaarder om mee te testen. */
    pinUitkomst: regie.pinUitkomst,
    pinVertragingMs: regie.pinVertragingMs,
    terugstortingen: [],
  };

  await muteer(PAD.betalingen, (lijst) => [betaling, ...(Array.isArray(lijst) ? lijst : [])].slice(0, 500), []);
  return json(alsBetaling(betaling, 'open'), 201);
}

async function haalBetaling(betaalId) {
  const regie = await leesRegie();
  const b = (await lees(PAD.betalingen, [])).find((x) => x.id === betaalId);
  if (!b) return foutJson(`Betaling ${betaalId} bestaat niet in de sandbox.`, 404);
  return json(alsBetaling(b, huidigeStatus(b, regie)));
}

async function annuleerBetaling(betaalId) {
  const regie = await leesRegie();
  let gevonden = null;
  await muteer(PAD.betalingen, (lijst) => (Array.isArray(lijst) ? lijst : []).map((b) => {
    if (b.id !== betaalId) return b;
    /* Een al betaalde transactie annuleren mag niet — anders zou de kassa een
       "geannuleerde" verkoop kunnen tonen waar het geld wél binnen is. */
    if (huidigeStatus(b, regie) === 'paid') { gevonden = { fout: true, b }; return b; }
    gevonden = { fout: false, b: { ...b, status: 'canceled' } };
    return gevonden.b;
  }), []);

  if (!gevonden) return foutJson(`Betaling ${betaalId} bestaat niet in de sandbox.`, 404);
  if (gevonden.fout) return foutJson('Deze betaling is al voldaan en kan niet meer geannuleerd worden.', 422);
  return json(alsBetaling(gevonden.b, 'canceled'));
}

async function stortTerug(betaalId, verzoek) {
  let body = {};
  try { body = JSON.parse(verzoek.lichaam || '{}'); } catch { body = {}; }

  const sleutel = String(verzoek.headers.get('idempotency-key') || '').trim();
  const regie = await leesRegie();
  const alles = await lees(PAD.betalingen, []);
  const b = alles.find((x) => x.id === betaalId);
  if (!b) return foutJson(`Betaling ${betaalId} bestaat niet in de sandbox.`, 404);

  if (sleutel) {
    const bestaand = (b.terugstortingen || []).find((r) => r.idempotencySleutel === sleutel);
    if (bestaand) return json(bestaand.object);
  }

  if (huidigeStatus(b, regie) !== 'paid') {
    return foutJson('Alleen een voldane betaling kan terugbetaald worden.', 422);
  }

  const gevraagd = centen(body.amount);
  const alTerug = (b.terugstortingen || []).reduce((s, r) => s + r.bedragCent, 0);
  if (gevraagd <= 0) return foutJson('Bedrag moet groter dan nul zijn.', 422);
  if (alTerug + gevraagd > b.bedragCent) {
    /* Dít is het geval waarvoor de eigen begrenzing in pin-mollie.js bestaat.
       Als de nabootsing het zou toestaan, test je die begrenzing nooit. */
    return foutJson(
      `Terugstorting van ${euro(gevraagd)} past niet: van ${euro(b.bedragCent)} is al ${euro(alTerug)} terugbetaald.`,
      422
    );
  }

  const object = {
    resource: 'refund',
    id: id('re'),
    amount: { currency: 'EUR', value: euro(gevraagd) },
    status: 'refunded',
    paymentId: b.id,
    createdAt: new Date().toISOString(),
  };

  await muteer(PAD.betalingen, (lijst) => (Array.isArray(lijst) ? lijst : []).map((x) => (
    x.id === betaalId
      ? { ...x, terugstortingen: [...(x.terugstortingen || []), { idempotencySleutel: sleutel || null, bedragCent: gevraagd, object }] }
      : x
  )), []);

  return json(object, 201);
}

export async function beantwoord(verzoek) {
  const pad = verzoek.url.pathname.replace(/\/+$/, '');

  if (verzoek.methode === 'POST' && pad === '/v2/payments') return maakBetaling(verzoek);

  const betaling = pad.match(/^\/v2\/payments\/(tr_[A-Za-z0-9]+)$/);
  if (betaling) {
    if (verzoek.methode === 'GET') return haalBetaling(betaling[1]);
    if (verzoek.methode === 'DELETE') return annuleerBetaling(betaling[1]);
  }

  const terug = pad.match(/^\/v2\/payments\/(tr_[A-Za-z0-9]+)\/refunds$/);
  if (terug && verzoek.methode === 'POST') return stortTerug(terug[1], verzoek);

  /* Terminals opvragen: de kassa controleert soms of een terminal bestaat. */
  if (verzoek.methode === 'GET' && pad.startsWith('/v2/terminals')) {
    return json({
      count: 1,
      _embedded: {
        terminals: [{
          resource: 'terminal', id: 'term_sandbox', status: 'active',
          brand: 'Sandbox', model: 'Nep-pinautomaat', description: 'Sandbox-terminal',
        }],
      },
    });
  }

  return foutJson(`Mollie-pad ${verzoek.methode} ${pad} wordt in de sandbox niet nagebootst.`, 404);
}
