/**
 * lib/sandbox/nep-meta.js — WhatsApp zonder Meta.
 *
 * De WhatsApp-rail stuurt berichten naar echte telefoons van echte klanten. In
 * de sandbox gaan ze naar hetzelfde postvak als de mail, zodat een tester in
 * één lijst ziet wat er "naar buiten" zou zijn gegaan.
 *
 * Templates worden bewust NIET gecontroleerd op goedkeuring: Meta weigert een
 * niet-goedgekeurde template, maar dat is een proces-probleem (WhatsApp
 * Manager), geen code-probleem, en het zou de sandbox alleen maar in de weg
 * zitten. Wat de sandbox wél bewaart is welke template met welke variabelen
 * verstuurd zou zijn — daar zitten de echte fouten (verkeerde volgorde,
 * ontbrekende parameter).
 */

import { PAD, voegToe } from './state.js';

const JSON_KOP = { 'content-type': 'application/json; charset=utf-8', 'x-gents-sandbox': 'meta' };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_KOP });
}

/** "Hallo {{1}}, uw pak ligt klaar" → leesbaar maken van de variabelen. */
function templateSamenvatting(sjabloon) {
  if (!sjabloon) return { naam: '', taal: '', variabelen: [] };
  const variabelen = [];
  for (const onderdeel of sjabloon.components || []) {
    for (const p of onderdeel.parameters || []) {
      variabelen.push(String(p.text ?? p.image?.link ?? p.document?.link ?? ''));
    }
  }
  return {
    naam: String(sjabloon.name || ''),
    taal: String(sjabloon.language?.code || ''),
    variabelen,
  };
}

export async function beantwoord(verzoek) {
  /* Alleen /{versie}/{nummer-id}/messages is interessant; de rest van de Graph
     API raken we niet aan. */
  if (verzoek.methode !== 'POST' || !/\/messages\/?$/.test(verzoek.url.pathname)) {
    return json({ error: { message: `sandbox: Graph-pad ${verzoek.url.pathname} wordt niet nagebootst.`, type: 'SandboxError', code: 404 } }, 404);
  }

  let bericht = {};
  try { bericht = JSON.parse(verzoek.lichaam || '{}'); } catch { bericht = {}; }

  const naar = String(bericht.to || '');
  const soort = String(bericht.type || 'text');
  const id = `wamid.sandbox${Date.now().toString(16)}`;

  await voegToe(PAD.postvak, {
    id,
    kanaal: 'whatsapp',
    op: new Date().toISOString(),
    van: verzoek.url.pathname.split('/').filter(Boolean)[1] || '',
    aan: [naar],
    onderwerp: soort === 'template'
      ? `Template: ${bericht.template?.name || '(naamloos)'}`
      : 'Vrij tekstbericht',
    tekst: soort === 'template' ? '' : String(bericht.text?.body || ''),
    sjabloon: soort === 'template' ? templateSamenvatting(bericht.template) : null,
  });

  return json({
    messaging_product: 'whatsapp',
    contacts: [{ input: naar, wa_id: naar }],
    messages: [{ id }],
  });
}
