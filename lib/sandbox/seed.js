/**
 * lib/sandbox/seed.js — de startwereld van de sandbox.
 *
 * Bewust NIET een kopie van productie: geen echte klantgegevens, geen echte
 * medewerkers, geen echte bonnen. Wel dezelfde VORM als productie, want daar
 * gaat het om — filiaalnummers uit de echte lijst (branch-metrics.js), scancodes
 * in het 29000-formaat dat SRS gebruikt, artikelnummers met de nul-opvulling
 * waar de productfeed op sleutelt.
 *
 * Namen zijn duidelijk verzonnen ("Sanne Sandbox"), zodat niemand in een
 * schermafbeelding of een testbon denkt naar een echte collega te kijken.
 *
 * Vier filialen is genoeg om alles te testen wat filiaal-afhankelijk is:
 * twee winkels (voor uitwisselingen en winkel-afscherming), het magazijn (voor
 * weborders) en de showroom (de pilotwinkel van de kassa).
 */

export const DEMO_FILIALEN = [
  { store: 'GENTS Showroom', filiaal: '700' },
  { store: 'GENTS Utrecht', filiaal: '18' },
  { store: 'GENTS Breda', filiaal: '4' },
  { store: 'GENTS Magazijn', filiaal: '99' },
];

/**
 * Kassiers. `posLoginCode` is de code waarmee ze aan de kassa inloggen — in de
 * sandbox expres kort en opschrijfbaar, want testers moeten hem kunnen delen.
 * In productie komt deze waarde uit SRS en staat hij nergens in code.
 */
export const DEMO_PERSONEEL = [
  {
    personnelId: '9001',
    internalName: 'Sanne Sandbox',
    externalName: 'Sanne',
    posLoginCode: '1111',
    groupId: '1',
    branches: ['700', '18'],
    active: true,
  },
  {
    personnelId: '9002',
    internalName: 'Tim Testkassa',
    externalName: 'Tim',
    posLoginCode: '2222',
    groupId: '1',
    branches: ['18'],
    active: true,
  },
  {
    personnelId: '9003',
    internalName: 'Bram Bedrijfsleider',
    externalName: 'Bram',
    posLoginCode: '3333',
    groupId: '2',
    branches: ['700', '18', '4'],
    active: true,
  },
  {
    personnelId: '9004',
    internalName: 'Wim Weg (uit dienst)',
    externalName: 'Wim',
    posLoginCode: '4444',
    groupId: '1',
    branches: ['4'],
    /* Bewust inactief: hiermee test je dat een oud-medewerker NIET meer op de
       kassa kan inloggen. Zonder zo'n geval test je dat pad nooit. */
    active: false,
  },
];

/**
 * Artikelen. Een pak, een colbert + bijpassende broek (voor MixMatch), een
 * overhemd, schoenen en een accessoire — plus expres één artikel dat bijna op
 * is en één dat nergens meer ligt, want de interessante fouten zitten in de
 * randen: "laatste stuk verkocht", "uitverkocht maar toch besteld".
 */
export const DEMO_ARTIKELEN = [
  { artikel: '00009101', scancode: '2900000091011', naam: 'Sandbox pak marine',        maat: '52', prijsCent: 39900 },
  { artikel: '00009102', scancode: '2900000091028', naam: 'Sandbox colbert grijs',     maat: '52', prijsCent: 24900 },
  { artikel: '00009103', scancode: '2900000091035', naam: 'Sandbox broek grijs',       maat: '52', prijsCent: 12900 },
  { artikel: '00009104', scancode: '2900000091042', naam: 'Sandbox overhemd wit',      maat: '41', prijsCent: 6995 },
  { artikel: '00009105', scancode: '2900000091059', naam: 'Sandbox schoen bruin',      maat: '43', prijsCent: 14900 },
  { artikel: '00009106', scancode: '2900000091066', naam: 'Sandbox stropdas bordeaux', maat: 'ONE', prijsCent: 3995 },
  { artikel: '00009107', scancode: '2900000091073', naam: 'Sandbox gilet marine',      maat: '52', prijsCent: 9900 },
  { artikel: '00009108', scancode: '2900000091080', naam: 'Sandbox smoking zwart',     maat: '54', prijsCent: 49900 },
];

/**
 * Beginvoorraad, gesleuteld op "filiaal|scancode" — dezelfde sleutel die de
 * nep-SRS bijhoudt en afboekt bij een verkoop.
 */
export const DEMO_VOORRAAD = {
  // GENTS Showroom (700) — de pilotwinkel, ruim gevuld
  '700|2900000091011': 6,
  '700|2900000091028': 4,
  '700|2900000091035': 4,
  '700|2900000091042': 12,
  '700|2900000091059': 3,
  '700|2900000091066': 20,
  '700|2900000091073': 2,
  '700|2900000091080': 1,   // laatste stuk: verkoop 'm en de voorraad staat op 0

  // GENTS Utrecht (18) — tweede winkel, voor uitwisselingen
  '18|2900000091011': 2,
  '18|2900000091028': 1,
  '18|2900000091042': 5,
  '18|2900000091066': 8,
  '18|2900000091080': 0,    // uitverkocht in deze winkel, wél in de showroom

  // GENTS Breda (4)
  '4|2900000091011': 0,
  '4|2900000091042': 3,
  '4|2900000091059': 1,

  // GENTS Magazijn (99) — bron voor weborders
  '99|2900000091011': 25,
  '99|2900000091028': 10,
  '99|2900000091035': 10,
  '99|2900000091042': 40,
  '99|2900000091059': 15,
  '99|2900000091066': 60,
  '99|2900000091073': 8,
  '99|2900000091080': 4,
};

/**
 * Portaal-gebruikers.
 *
 * Zonder deze lijst is een verse sandbox onbruikbaar, en dat is niet meteen
 * zichtbaar: de winkel-login werkt namelijk wél (die loopt via de nep-SRS
 * hierboven), maar je komt binnen als gewone winkelmedewerker. En om jezelf
 * rechten te geven heb je Gebruikersbeheer nodig — waar je met die rechten
 * niet bij kunt. Kip-en-ei.
 *
 * De portaal-accounts staan namelijk in de BLOB-store, niet in de database.
 * De nachtelijke database-verversing brengt ze dus niet mee; een nieuwe
 * sandbox-blobstore begint leeg. Vandaar dat we ze hier zaaien.
 *
 * Wachtwoorden staan expres leesbaar in de broncode. Dat kan omdat ze alleen in
 * de sandbox bestaan: het netwerkslot maakt echte schade onmogelijk, de data is
 * geanonimiseerd, en testers moeten deze gegevens onderling kunnen delen. Voor
 * productie zou dit onacceptabel zijn — daar komt geen enkele van deze
 * accounts, want dit bestand wordt alleen gelezen als GENTS_SANDBOX=1.
 *
 * Vier rollen, zodat je ook kunt testen wat iemand NIET mag zien. Dat is
 * minstens zo belangrijk als testen wat wel mag.
 */
export const DEMO_PORTAAL_GEBRUIKERS = [
  {
    email: 'beheerder@sandbox.invalid',
    naam: 'Bea Beheerder',
    wachtwoord: 'sandbox-beheer',
    afdeling: 'Kantoor',
    rol: 'admin',
    winkels: [],           // admin ziet alles
  },
  {
    email: 'shopmanager@sandbox.invalid',
    naam: 'Sam Shopmanager',
    wachtwoord: 'sandbox-shop',
    afdeling: 'Retail',
    rol: 'shop_manager',
    winkels: ['GENTS Showroom'],
  },
  {
    email: 'medewerker@sandbox.invalid',
    naam: 'Mo Medewerker',
    wachtwoord: 'sandbox-winkel',
    afdeling: 'Retail',
    rol: 'medewerker',
    winkels: ['GENTS Utrecht'],
  },
  {
    email: 'finance@sandbox.invalid',
    naam: 'Fien Finance',
    wachtwoord: 'sandbox-finance',
    afdeling: 'Finance',
    rol: 'finance',
    winkels: [],
  },
];

/**
 * Rollen voor de kassiers uit DEMO_PERSONEEL. Zonder een regel hier erft een
 * personeelsnummer de standaardrol 'medewerker' — prima voor Sanne en Tim, maar
 * Bram moet bedrijfsleider zijn om het verschil te kunnen testen.
 */
export const DEMO_PERSONEEL_ROLLEN = {
  9003: { role: 'shop_manager', department: 'Retail', notes: 'Sandbox-bedrijfsleider' },
};

/**
 * Klanten voor de kassa (bon koppelen, punten, retour op bon). Mailadressen op
 * `sandbox.invalid` — een domein dat volgens RFC 6761 gegarandeerd niet bestaat,
 * dus zelfs als er ooit een mail langs het netwerkslot glipt kan hij nergens
 * aankomen. Een `@gents.nl`-adres zou dat niet geven.
 */
export const DEMO_KLANTEN = [
  { id: 'sb-klant-1', naam: 'Jan Jansen',    email: 'jan@sandbox.invalid',    telefoon: '0612000001', punten: 250 },
  { id: 'sb-klant-2', naam: 'Piet de Vries', email: 'piet@sandbox.invalid',   telefoon: '0612000002', punten: 0 },
  { id: 'sb-klant-3', naam: 'Karel Karels',  email: 'karel@sandbox.invalid',  telefoon: '0612000003', punten: 1840 },
];
