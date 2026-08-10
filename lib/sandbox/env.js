/**
 * lib/sandbox/env.js — staat deze omgeving in sandbox-stand, en is hij schoon?
 *
 * De sandbox is een APARTE omgeving (eigen Vercel-project, eigen Neon-branch,
 * eigen blob-store). Deze module beantwoordt maar twee vragen:
 *
 *   1. isSandbox()      — mag ik nep-diensten gebruiken i.p.v. de echte wereld?
 *   2. sleutelKlachten() — zitten er per ongeluk ECHTE sleutels in?
 *
 * VEILIGHEIDSMODEL (fail-closed, twee kanten op):
 *
 *  - Zonder GENTS_SANDBOX=1 doet dit hele mapje NIETS. Productie draait dus
 *    exact zoals nu; er is geen pad waarlangs de nep-diensten "per ongeluk aan"
 *    kunnen staan.
 *  - Mét GENTS_SANDBOX=1 eisen we dat elke sleutel van een EXTERNE partij het
 *    voorvoegsel `sandbox-` heeft. Zo kan een sandbox-deploy nooit met een echte
 *    SRS/Resend/Mollie/Meta-sleutel draaien — precies de fout die bij de
 *    preview-omgeving van storeportal wél gemaakt is (previews kregen daar de
 *    productie-secrets). Klopt het niet, dan weigert het netwerkslot te starten
 *    en valt de sandbox stuk i.p.v. stilletjes de echte wereld te raken.
 *
 * Waarom een voorvoegsel en geen vergelijking met de productiewaarde: een
 * draaiende functie kent de productiewaarden niet. Een voorvoegsel is wél
 * lokaal controleerbaar. De vergelijking mét productie doet
 * `scripts/sandbox-check.mjs` bij het uitrollen.
 */

/** Sleutels van EXTERNE partijen: hier hangt echt geld / echte klantcontact aan. */
export const EXTERNE_SLEUTELS = [
  'SRS_MESSAGE_PASSWORD',
  'SRS_BOEKBON_PASSWORD',
  'RESEND_API_KEY',
  'MOLLIE_API_KEY',
  'WHATSAPP_TOKEN',
  'EXACT_CLIENT_SECRET',
  'SENDCLOUD_SECRET',
  'DHL_API_KEY',
  'RETURNISTA_API_KEY',
  'WORLDLINE_API_SECRET',
];

const VOORVOEGSEL = 'sandbox-';

export function isSandbox() {
  return process.env.GENTS_SANDBOX === '1';
}

/** Naam in de balk boven elke pagina, bv. "Sandbox" of "Sandbox — training". */
export function sandboxNaam() {
  return String(process.env.SANDBOX_NAAM || 'Sandbox').trim() || 'Sandbox';
}

/**
 * Welke externe sleutels zien er ECHT uit? Lege waarden zijn prima (de nep-dienst
 * heeft geen sleutel nodig) — alleen een gevulde waarde zónder `sandbox-`
 * voorvoegsel is verdacht.
 *
 * Geeft alleen NAMEN terug, nooit waarden: deze lijst komt in logs en in de
 * sandbox-statuspagina terecht.
 */
export function sleutelKlachten(env = process.env) {
  const klachten = [];
  for (const naam of EXTERNE_SLEUTELS) {
    const waarde = String(env[naam] || '').trim();
    if (!waarde) continue;
    if (!waarde.startsWith(VOORVOEGSEL)) klachten.push(naam);
  }
  return klachten;
}

/**
 * Gooit als de sandbox met echte sleutels draait. Het netwerkslot roept dit aan
 * bij het installeren; daardoor faalt zo'n omgeving meteen en zichtbaar in
 * plaats van pas op het moment dat er een echte bon geboekt of mail verstuurd
 * wordt.
 */
export function eisSchoneSleutels(env = process.env) {
  const klachten = sleutelKlachten(env);
  if (!klachten.length) return;
  throw new Error(
    `Sandbox geweigerd: ${klachten.join(', ')} ${klachten.length === 1 ? 'ziet er' : 'zien eruit'} als een ECHTE sleutel. ` +
    `In de sandbox moet elke externe sleutel met "${VOORVOEGSEL}" beginnen (bv. ${VOORVOEGSEL}srs). ` +
    `Zet de echte waarde terug in het productieproject en geef de sandbox een nepwaarde.`
  );
}

/** Waar de sandbox-tegenhangers van onze eigen systemen staan (voor omleiding). */
export function eigenSandboxHosts() {
  const schoon = (v) => String(v || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  return {
    site: schoon(process.env.SANDBOX_SITE_URL),      // tegenhanger van gents.nl
    portal: schoon(process.env.SANDBOX_PORTAL_URL),  // tegenhanger van portal.gents.nl
  };
}
