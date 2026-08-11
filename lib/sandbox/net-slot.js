/**
 * lib/sandbox/net-slot.js — het slot op de voordeur van de sandbox.
 *
 * WAAROM DIT BESTAAT
 * Een sandbox die alleen op env-vars leunt is lek. In deze repo staan de
 * externe adressen op 94 plekken hard in de code (59× `messages.storeinfo.nl`
 * alleen al); één vergeten `SRS_BASE_URL` en de "veilige" sandbox boekt een
 * echte bon of mailt een echte klant. Daarom grijpen we niet per koppeling in,
 * maar op de enige plek waar ALLE koppelingen langskomen: `fetch`.
 *
 * DRIE UITKOMSTEN, EN GEEN VIERDE
 *   doorlaten  — eigen infrastructuur (blob, Neon, de sandbox-deploys zelf)
 *   omleiden   — onze eigen productie-hosts → hun sandbox-tegenhanger
 *   nabootsen  — externe partijen (SRS, Resend, Meta, Mollie, …) → nep-antwoord
 *
 * Alles wat in geen van die drie past wordt GEBLOKKEERD. Dat is de kern van het
 * ontwerp: niet "de bekende gevaren tegenhouden", maar "alleen het bekend
 * veilige toelaten". Een koppeling die morgen wordt toegevoegd is in de sandbox
 * dus automatisch dicht, niet automatisch open.
 *
 * De nep-antwoorden komen IN HET PROCES tot stand (geen HTTP naar onszelf).
 * Dat scheelt een netwerkgang per aanroep en werkt ook lokaal zonder dat de
 * sandbox z'n eigen URL hoeft te kennen.
 */

import { isSandbox, eisSchoneSleutels, eigenSandboxHosts, sandboxNaam } from './env.js';

/* De ECHTE fetch bewaren vóór we hem vervangen. De nep-diensten gebruiken deze
   om hun eigen opslag (blob) te bereiken — anders zou het slot zichzelf
   onderscheppen en oneindig doorlussen. */
export const ECHTE_FETCH = typeof globalThis.fetch === 'function'
  ? globalThis.fetch.bind(globalThis)
  : null;

/**
 * Eigen infrastructuur: mag onbeperkt naar buiten.
 *
 * `neon.tech` dekt twee heel verschillende dingen, en dat is bewust:
 *  - de database-endpoints (ep-….neon.tech) — de sandbox-branch, dagelijks werk;
 *  - console.neon.tech, de BEHEER-API — nodig voor de nachtelijke verversing.
 *
 * Dat tweede is de enige plek waar de sandbox iets kan aanraken buiten zichzelf.
 * De bescherming zit daarom niet hier maar in `lib/sandbox-verversen.ts`
 * (gentsnext): die weigert te werken tenzij het doel aantoonbaar een kind van
 * productie is én niet de standaard-branch. Gebruik daarnaast een
 * PROJECT-GESCOPEERDE Neon-sleutel, zodat een gelekte sandbox-sleutel niet bij
 * andere projecten kan.
 */
const DOORLATEN = [
  /(^|\.)vercel-storage\.com$/,   // Vercel Blob (sandbox-store)
  /(^|\.)neon\.tech$/,            // Neon: database-branch + beheer-API (zie boven)
  /(^|\.)vercel\.app$/,           // de sandbox-deploys onderling
  /^localhost$/,
  /^127\.0\.0\.1$/,
  /^\[::1\]$/,
];

/** Onze eigen productie-hosts → de sandbox-tegenhanger. */
function omleiding(host) {
  const eigen = eigenSandboxHosts();
  if (/^(www\.)?gents\.nl$/.test(host)) return eigen.site || null;
  if (/^portal\.gents\.nl$/.test(host)) return eigen.portal || null;
  return null;
}

/**
 * Externe partijen die we nabootsen. Volgorde telt niet; de eerste `past` wint.
 * De modules worden lui geladen zodat een sandbox die nooit mailt ook nooit de
 * mail-nabootser inleest.
 */
const NEP_DIENSTEN = [
  {
    naam: 'SRS',
    past: (h) => /(^|\.)srs\.nl$/.test(h) || /(^|\.)storeinfo\.nl$/.test(h),
    laad: () => import('./nep-srs.js'),
  },
  {
    naam: 'Resend (e-mail)',
    past: (h) => h === 'api.resend.com',
    laad: () => import('./nep-resend.js'),
  },
  {
    naam: 'Meta (WhatsApp)',
    past: (h) => h === 'graph.facebook.com',
    laad: () => import('./nep-meta.js'),
  },
  {
    naam: 'Mollie (betalen + pin)',
    past: (h) => /(^|\.)mollie\.com$/.test(h),
    laad: () => import('./nep-mollie.js'),
  },
];

/**
 * Hosts die we bewust NIET nabootsen maar wel stil doodlopen: koppelingen die
 * niets kapotmaken als ze zwijgen, en waarvoor een nepantwoord alleen maar
 * verwarrend zou zijn. De aanroeper krijgt een net 503'je — alle betrokken
 * clients zijn best-effort en vangen dat al af.
 */
const STIL_DICHT = [
  /(^|\.)googleapis\.com$/,
  /(^|\.)google\.com$/,
  /(^|\.)mailplus\.nl$/,
  /(^|\.)returnista\.com$/,
  /(^|\.)exactonline\.nl$/,
  /(^|\.)daisycon\.com$/,
  /(^|\.)zendesk\.com$/,
  /(^|\.)dhlparcel\.nl$/,
  /(^|\.)sendcloud\.(sc|nl|com)$/,
  /(^|\.)project-osrm\.org$/,
  /(^|\.)anthropic\.com$/,
  /(^|\.)openai\.com$/,
  /(^|\.)reddit\.com$/,
];

function past(host, lijst) {
  return lijst.some((r) => r.test(host));
}

function jsonAntwoord(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-gents-sandbox': '1' },
  });
}

/**
 * Een geblokkeerd verzoek geeft een fout die de ontwikkelaar meteen begrijpt —
 * inclusief wat te doen. Geen mysterieuze DNS-fout of hangende socket.
 */
function blokkade(host, url) {
  const bericht =
    `[${sandboxNaam()}] Uitgaand verzoek naar ${host} geblokkeerd.\n` +
    `De sandbox laat alleen bekende hosts door. Dit is geen bug in je code — ` +
    `de koppeling is nog niet nagebootst.\n` +
    `Oplossen: voeg ${host} toe aan NEP_DIENSTEN (met een nep-antwoord) of aan ` +
    `STIL_DICHT (als zwijgen goed genoeg is) in lib/sandbox/net-slot.js.\n` +
    `Volledige URL: ${url}`;
  const fout = new Error(bericht);
  fout.name = 'SandboxBlokkade';
  fout.host = host;
  return fout;
}

/**
 * Verzoek normaliseren. `fetch` accepteert een string, een URL of een Request,
 * met of zonder init — de nep-diensten willen daar geen last van hebben en
 * krijgen altijd dezelfde vorm.
 *
 * LET OP: `new Request(input, init)` LEEGT het lichaam van `input` als dat zelf
 * een Request was. Het origineel is daarna onbruikbaar. Daarom bouwen we hier
 * één Request (`bron`) en werkt al het vervolg met díé — nooit meer met de
 * oorspronkelijke argumenten.
 */
async function normaliseer(input, init) {
  const bron = new Request(input, init);
  let lichaam = '';
  if (bron.method !== 'GET' && bron.method !== 'HEAD') {
    lichaam = await bron.clone().text().catch(() => '');
  }
  return {
    bron,
    url: new URL(bron.url),
    methode: bron.method.toUpperCase(),
    headers: bron.headers,
    lichaam,
    /** SOAPAction is bij SRS de enige manier om te zien wát er gevraagd wordt. */
    soapActie: String(bron.headers.get('soapaction') || '').replace(/^"|"$/g, ''),
  };
}

let geinstalleerd = false;

/**
 * Vervangt de globale fetch. Idempotent en no-op buiten de sandbox, zodat deze
 * module gerust vanuit 94 bestanden geïmporteerd mag worden.
 */
export function installeerNetSlot() {
  if (!isSandbox() || geinstalleerd || !ECHTE_FETCH) return false;

  /* Eerst de sleutelcontrole: liever nu hard stuk dan straks een echte bon. */
  eisSchoneSleutels();

  geinstalleerd = true;

  globalThis.fetch = async function sandboxFetch(input, init) {
    let verzoek;
    try {
      verzoek = await normaliseer(input, init);
    } catch {
      /* Onparseerbaar verzoek: laat de echte fetch de fout geven die hij altijd
         al gaf — het slot mag geen nieuwe faalmodus introduceren. */
      return ECHTE_FETCH(input, init);
    }

    const host = verzoek.url.hostname.toLowerCase();

    if (past(host, DOORLATEN)) return ECHTE_FETCH(verzoek.bron);

    const naar = omleiding(host);
    if (naar) {
      const nieuw = new URL(verzoek.url);
      const [nieuweHost, nieuwePoort] = naar.split(':');
      nieuw.hostname = nieuweHost;
      nieuw.port = nieuwePoort || '';
      /* Opnieuw opbouwen i.p.v. de bron doorgeven: een Request is aan z'n URL
         vastgeklonken, die kun je niet omzetten. Headers en lichaam nemen we
         letterlijk over. */
      return ECHTE_FETCH(new Request(nieuw, {
        method: verzoek.methode,
        headers: verzoek.headers,
        body: verzoek.methode === 'GET' || verzoek.methode === 'HEAD' ? undefined : verzoek.lichaam,
        redirect: verzoek.bron.redirect,
      }));
    }

    for (const dienst of NEP_DIENSTEN) {
      if (!dienst.past(host)) continue;
      const mod = await dienst.laad();
      return mod.beantwoord(verzoek);
    }

    if (past(host, STIL_DICHT)) {
      await logBlokkade(host, verzoek.url.href, 'stil-dicht');
      return jsonAntwoord(
        { sandbox: true, message: `${host} is in de sandbox uitgeschakeld.` },
        503
      );
    }

    await logBlokkade(host, verzoek.url.href, 'geblokkeerd');
    throw blokkade(host, verzoek.url.href);
  };

  return true;
}

/**
 * Blokkades belanden in het sandbox-logboek zodat je in de portal ziet wat de
 * sandbox tegenhield. Best-effort: als loggen niet lukt mag dat het verzoek
 * nooit anders laten aflopen.
 */
async function logBlokkade(host, url, soort) {
  try {
    const { voegToe, PAD } = await import('./state.js');
    await voegToe(PAD.logboek, { op: new Date().toISOString(), host, url, soort });
  } catch {
    /* stil — het logboek is een hulpmiddel, geen voorwaarde */
  }
}
