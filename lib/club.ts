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
