/**
 * lib/club.ts
 *
 * "GENTS MEMBERS" — de merknaam van ons spaarprogramma (t/m 13 aug 2026 "The
 * Club of GENTS"; de code houdt de oude CLUB_-namen aan, zie onderaan). Eén bron, want de
 * naam staat op tientallen plekken (site, klantmails, wallet-passen, de uitleg
 * aan de kassa) en een merknaam die je overal los intikt staat er binnen een
 * half jaar op drie manieren.
 *
 * Taalmodel — bewust uit elkaar gehouden:
 *   het PROGRAMMA  → "GENTS MEMBERS"  (merknaam, blijft onvertaald)
 *   de MUNTEENHEID → "punten"
 *   de PAS         → "memberspas" (in Apple/Google Wallet én in het account)
 *
 * De naam blijft in élke taal ongewijzigd; lib/translate houdt 'm daarom net als
 * "GENTS" en de tagline buiten de vertaalronde.
 */

/** De merknaam van het spaarprogramma. Nooit vertalen, nooit afkorten. */
export const CLUB_NAME = "GENTS MEMBERS";

/** De publieke uitlegpagina van het programma. */
export const CLUB_PATH = "/members";

/**
 * De spaarpas in Apple/Google Wallet, zoals de klant 'm in z'n telefoon ziet.
 * LET OP: dit is puur een weergavenaam. De klasse-/pas-ID's (loyaltyClassId,
 * APPLE_PASS_TYPE_ID) staan hier bewust los van — die veranderen zou elke
 * bestaande pas van een klant losknippen.
 */
export const CLUB_PASS_NAME = "GENTS Memberspas";

/**
 * Het clubmerkteken. Twee kleuren, verder identiek: transparante achtergrond,
 * 1200x389. Zwart voor de canvas-achtergrond, wit voor alles wat op ink staat
 * (de zwarte wallet-pas, donkere blokken). Kies op ondergrond, niet op thema.
 *
 * Verhouding staat er expliciet bij zodat <Image> niet hoeft te gokken en de
 * pagina niet verspringt terwijl het beeld laadt.
 */
export const CLUB_LOGO_DARK = "/brand/gents-members-zwart.png";
export const CLUB_LOGO_LIGHT = "/brand/gents-members-wit.png";
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

/*
 * Waarom de constanten en de i18n-sleutels nog CLUB_/club. heten terwijl het
 * programma GENTS MEMBERS is: de sleutels zijn de sleutel van de vertaalstore.
 * Hernoemen gooit de en/de/fr/es-vertalingen van élke sleutel weg tot de
 * vertaal-cron opnieuw draait, en levert verder niets op voor een klant. De
 * NAAM leeft in CLUB_NAME; dit bestand is de enige plek waar je 'm verandert.
 */
