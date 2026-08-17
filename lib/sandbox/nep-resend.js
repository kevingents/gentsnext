/**
 * lib/sandbox/nep-resend.js — e-mail die nergens aankomt.
 *
 * Elke mail die de sandbox verstuurt belandt in het sandbox-postvak in plaats
 * van in een echte inbox. Dat is niet alleen een veiligheidsmaatregel maar ook
 * de handigste manier om mails te testen: je ziet de HTML, de afzender, de
 * ontvangers en de bijlagen bij elkaar, zonder te wachten op bezorging of te
 * puzzelen met plus-adressen.
 *
 * De antwoordvorm volgt de echte Resend-API ({ id }), zodat de `resend`-SDK en
 * de plekken die rauw fetchen allebei tevreden zijn.
 */

import { PAD, voegToe, leesRegie } from './state.js';

const JSON_KOP = { 'content-type': 'application/json; charset=utf-8', 'x-gents-sandbox': 'resend' };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_KOP });
}

function nepId(voorvoegsel) {
  const willekeurig = Math.random().toString(16).slice(2, 10);
  return `${voorvoegsel}_${Date.now().toString(16)}${willekeurig}`;
}

function lijst(v) {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]).map((x) => String(x)).filter(Boolean);
}

/** Eén mail opbergen in het postvak. */
async function bergOp(mail) {
  const id = nepId('sbmail');
  await voegToe(PAD.postvak, {
    id,
    kanaal: 'e-mail',
    op: new Date().toISOString(),
    van: String(mail.from || ''),
    aan: lijst(mail.to),
    cc: lijst(mail.cc),
    bcc: lijst(mail.bcc),
    antwoordNaar: String(mail.reply_to || mail.replyTo || ''),
    onderwerp: String(mail.subject || ''),
    html: String(mail.html || ''),
    tekst: String(mail.text || ''),
    bijlagen: (mail.attachments || []).map((b) => ({
      naam: b.filename || b.name || 'bijlage',
      /* Alleen de omvang bewaren, niet de inhoud: een pakbon-PDF van een paar
         honderd kB per mail blaast het postvak op. */
      bytes: b.content ? String(b.content).length : 0,
    })),
  });
  return id;
}

export async function beantwoord(verzoek) {
  const pad = verzoek.url.pathname.replace(/\/+$/, '');
  const regie = await leesRegie();

  /* Aflevering laten mislukken is een eigen testgeval: de portal moet een
     mislukte mail netjes loggen en niet de hele actie laten klappen. */
  if (regie.mailAflevering === 'mislukt' && verzoek.methode === 'POST' && pad.startsWith('/emails')) {
    return json({ name: 'application_error', message: 'sandbox: verzenden geweigerd (ingesteld via de regieknop)' }, 500);
  }

  if (verzoek.methode === 'POST' && pad === '/emails') {
    let mail = {};
    try { mail = JSON.parse(verzoek.lichaam || '{}'); } catch { mail = {}; }
    const id = await bergOp(mail);
    return json({ id });
  }

  if (verzoek.methode === 'POST' && pad === '/emails/batch') {
    let mails = [];
    try { mails = JSON.parse(verzoek.lichaam || '[]'); } catch { mails = []; }
    const data = [];
    for (const mail of Array.isArray(mails) ? mails : []) {
      data.push({ id: await bergOp(mail) });
    }
    return json({ data });
  }

  /* Nieuwsbrief-doelgroepen en contacten: bevestigen zonder iets te bewaren.
     Er gaat geen bericht uit, dus er valt niets te onderscheppen — en de
     aanroepers kijken alleen of het gelukt is. */
  if (pad.startsWith('/audiences') || pad.startsWith('/contacts')) {
    if (verzoek.methode === 'GET') return json({ data: [] });
    return json({ id: nepId('sbaud'), object: 'contact' });
  }

  return json({ name: 'not_found', message: `sandbox: Resend-pad ${pad} wordt niet nagebootst.` }, 404);
}
