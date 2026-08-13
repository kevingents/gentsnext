/**
 * lib/club.ts
 *
 * "The Club of GENTS" — de merknaam van ons spaarprogramma. Eén bron, want de
 * naam staat op tientallen plekken (site, klantmails, wallet-passen, de uitleg
 * aan de kassa) en een merknaam die je overal los intikt staat er binnen een
 * half jaar op drie manieren.
 *
 * Taalmodel — bewust uit elkaar gehouden:
 *   het PROGRAMMA  → "The Club of GENTS"  (merknaam, blijft onvertaald)
 *   de MUNTEENHEID → "punten" / "clubpunten"
 *   de PAS         → "clubpas" (Apple/Google Wallet)
 *
 * De naam blijft in élke taal ongewijzigd; lib/translate houdt 'm daarom net als
 * "GENTS" en de tagline buiten de vertaalronde.
 */

/** De merknaam van het spaarprogramma. Nooit vertalen, nooit afkorten. */
export const CLUB_NAME = "The Club of GENTS";

/** De publieke uitlegpagina van het programma. */
export const CLUB_PATH = "/club";

/**
 * De spaarpas in Apple/Google Wallet, zoals de klant 'm in z'n telefoon ziet.
 * LET OP: dit is puur een weergavenaam. De klasse-/pas-ID's (loyaltyClassId,
 * APPLE_PASS_TYPE_ID) staan hier bewust los van — die veranderen zou elke
 * bestaande pas van een klant losknippen.
 */
export const CLUB_PASS_NAME = "GENTS Clubpas";

/**
 * Het clubmerkteken. Twee kleuren, verder identiek: transparante achtergrond,
 * 1200x389. Zwart voor de canvas-achtergrond, wit voor alles wat op ink staat
 * (de zwarte wallet-pas, donkere blokken). Kies op ondergrond, niet op thema.
 *
 * Verhouding staat er expliciet bij zodat <Image> niet hoeft te gokken en de
 * pagina niet verspringt terwijl het beeld laadt.
 */
export const CLUB_LOGO_DARK = "/brand/club-of-gents-zwart.png";
export const CLUB_LOGO_LIGHT = "/brand/club-of-gents-wit.png";
export const CLUB_LOGO_SIZE = { width: 1200, height: 389 } as const;

/**
 * De leesbare lidcode ("GENTS 1A2B3C4D"): de eerste 8 tekens van het klant-id
 * zonder streepjes. Staat onder de QR op élke verschijningsvorm van de pas —
 * Apple, Google en het scherm in het account — zodat een kassa die alleen een
 * invoerveld heeft er ook mee vooruit kan.
 *
 * Eén functie omdat dit een AFSPRAAK MET DE KASSA is, geen opmaak: /api/core/
 * customer-search snijdt aan de andere kant precies dezelfde 8 tekens af en
 * weigert een code die op twee klanten matcht. Wie hier het aantal tekens
 * verandert, moet daar mee.
 *
 * De regel zelf staat in lib/club-pas-regels.js zodat `node --test` 'm kan
 * vastleggen zonder de hele TypeScript-keten (zelfde patroon als
 * lib/punten-acties-regels.js).
 */
export { lidcode as clubMemberCode } from "@/lib/club-pas-regels";
