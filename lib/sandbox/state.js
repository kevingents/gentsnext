/**
 * lib/sandbox/state.js — het geheugen van de nep-diensten.
 *
 * De nep-SRS moet onthouden welke bonnen geboekt zijn en hoeveel voorraad er
 * nog ligt; het nep-postvak moet onthouden welke mails onderschept zijn. Op
 * Vercel leeft elke aanroep in een eigen proces, dus dat kan niet in het
 * geheugen van de functie. Opslag gaat daarom naar de blob-store van het
 * SANDBOX-project — die staat los van productie (eigen BLOB_READ_WRITE_TOKEN).
 *
 * BEWUST ZELFSTANDIG. Deze map praat rechtstreeks met `@vercel/blob` in plaats
 * van met de blob-helper van de portal, zodat `lib/sandbox/` in alle drie de
 * repo's (website, kassa/portal-backend, portal) exact hetzelfde bestand kan
 * zijn. Drie licht uiteenlopende kopieën van een veiligheidsmechanisme is
 * precies hoe zoiets in één repo stilletjes lek raakt.
 *
 * Alles onder één voorvoegsel `sandbox/`, zodat de resetknop de hele nep-wereld
 * in één keer kan opruimen.
 */

import { put, list } from '@vercel/blob';

export const PAD = {
  postvak: 'sandbox/postvak.json',       // onderschepte mail + WhatsApp
  srsBonnen: 'sandbox/srs-bonnen.json',  // geboekte kassabonnen (nep-SRS)
  srsVoorraad: 'sandbox/srs-voorraad.json',
  betalingen: 'sandbox/betalingen.json', // nep-Mollie + nep-pinautomaat
  regie: 'sandbox/regie.json',           // wat moet de volgende betaling/koppeling doen
  logboek: 'sandbox/logboek.json',       // geblokkeerde/omgeleide verzoeken
  verversen: 'sandbox/verversen.json',   // nachtelijke database-verversing: pauze + laatste uitslag
};

/** Nieuwste eerst, afgekapt: een sandbox mag nooit onbeperkt groeien. */
const MAX = {
  [PAD.postvak]: 500,
  [PAD.srsBonnen]: 500,
  [PAD.betalingen]: 500,
  [PAD.logboek]: 300,
};

async function zoekBlob(pad) {
  const gevonden = await list({ prefix: pad, limit: 1 });
  return (gevonden.blobs || []).find((b) => b.pathname === pad) || null;
}

export async function lees(pad, terugval = []) {
  try {
    const blob = await zoekBlob(pad);
    if (!blob) return terugval;
    /* Cache-buster: zonder deze serveert de CDN na een schrijf nog even de oude
       versie, en dan lijkt een net verstuurde mail niet in het postvak te staan. */
    const res = await fetch(`${blob.url}${blob.url.includes('?') ? '&' : '?'}_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return terugval;
    return JSON.parse(await res.text());
  } catch {
    /* In de sandbox is een onleesbare opslag hinderlijk, geen ramp: liever een
       lege lijst dan een kapotte testomgeving. Productie-data staat hier niet. */
    return terugval;
  }
}

export async function schrijf(pad, waarde) {
  await put(pad, JSON.stringify(waarde, null, 2), {
    access: 'public',
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });
  return waarde;
}

/**
 * Lezen-wijzigen-schrijven. Vercel Blob kent geen compare-and-swap, dus dit is
 * last-writer-wins. Voor een sandbox is dat prima: twee testers die op dezelfde
 * milliseconde afrekenen verliezen hooguit een regel in het postvak.
 */
export async function muteer(pad, wijzig, terugval = []) {
  const huidig = await lees(pad, terugval);
  const volgend = await wijzig(huidig);
  await schrijf(pad, volgend);
  return volgend;
}

/** Zet een item vooraan een lijst en kap af op de limiet voor dat pad. */
export async function voegToe(pad, item, limiet) {
  const max = limiet || MAX[pad] || 200;
  return muteer(pad, (huidig) => [item, ...(Array.isArray(huidig) ? huidig : [])].slice(0, max), []);
}

/**
 * De regie-instellingen: hiermee stuurt de tester de nep-wereld aan zonder code
 * te wijzigen — "laat de volgende pinbetaling mislukken", "laat SRS er vijf
 * seconden over doen", "laat de volgende boeking een fout geven".
 */
export const REGIE_STANDAARD = {
  pinUitkomst: 'geslaagd',    // geslaagd | mislukt | afgebroken | tijdsoverschrijding
  pinVertragingMs: 1200,      // hoe lang de nep-terminal "aan het wachten" is
  srsUitkomst: 'geslaagd',    // geslaagd | fout | traag
  srsVertragingMs: 0,
  mailAflevering: 'geslaagd', // geslaagd | mislukt
};

export async function leesRegie() {
  const r = await lees(PAD.regie, null);
  return { ...REGIE_STANDAARD, ...(r && typeof r === 'object' ? r : {}) };
}

export async function schrijfRegie(patch = {}) {
  const volgend = { ...(await leesRegie()), ...patch, gewijzigdOp: new Date().toISOString() };
  await schrijf(PAD.regie, volgend);
  return volgend;
}

/* ── Nachtelijke database-verversing ──────────────────────────────────────
   De cron draait in gentsnext, de pauzeknop staat in de portal. Ze vinden
   elkaar hier, in de blob-store die beide projecten delen.

   De pauze VERLOOPT bewust vanzelf. Een knop die blijft staan tot iemand hem
   uitzet, blijft staan — en dan test je een half jaar later op data van vorig
   kwartaal zonder dat iemand doorheeft dat de verversing al die tijd uit stond. */

const PAUZE_UREN = 24;

export async function leesVerversStand() {
  const s = await lees(PAD.verversen, null);
  const stand = (s && typeof s === 'object') ? s : {};
  const tot = stand.pauzeTot ? new Date(stand.pauzeTot).getTime() : 0;
  return {
    ...stand,
    /* Afgeleid, niet opgeslagen: een verlopen pauze is vanzelf geen pauze meer. */
    gepauzeerd: Number.isFinite(tot) && tot > Date.now(),
    pauzeTot: stand.pauzeTot || null,
  };
}

export async function zetPauze(aan, doorWie = '') {
  const huidig = await leesVerversStand();
  const volgend = {
    ...huidig,
    pauzeTot: aan ? new Date(Date.now() + PAUZE_UREN * 3600 * 1000).toISOString() : null,
    pauzeDoor: aan ? String(doorWie || '') : '',
  };
  delete volgend.gepauzeerd;
  await schrijf(PAD.verversen, volgend);
  return leesVerversStand();
}

/** De cron legt hier vast hoe het ging, zodat de portal het kan tonen. */
export async function legVerversingVast(uitslag) {
  const huidig = await leesVerversStand();
  const volgend = { ...huidig, laatste: { ...uitslag, op: new Date().toISOString() } };
  delete volgend.gepauzeerd;
  await schrijf(PAD.verversen, volgend);
  return volgend;
}

/** Alles wissen — gebruikt door de resetknop. */
export async function maakLeeg() {
  await Promise.all([
    schrijf(PAD.postvak, []),
    schrijf(PAD.srsBonnen, []),
    schrijf(PAD.srsVoorraad, {}),
    schrijf(PAD.betalingen, []),
    schrijf(PAD.logboek, []),
    schrijf(PAD.regie, { ...REGIE_STANDAARD, gewijzigdOp: new Date().toISOString() }),
  ]);
}
