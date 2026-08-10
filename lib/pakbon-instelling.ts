import type { Settings } from "@/lib/settings";

/**
 * lib/pakbon-instelling.ts — de pakbontekst valideren die uit de portal komt.
 *
 * Kevin, 6 aug: "wij moeten zelf de pakbon kunnen aanpassen in de portal".
 * Dit is het enige stuk GENTS dat de klant in de doos vindt, dus de invoer mag
 * niet zomaar doorlopen naar de printer: te lange regels lopen uit de kolom, en
 * het pipe-teken is in de printopdracht het scheidingsteken tussen velden.
 *
 * BEWUST GEEN "leeg = default": een lege regel betekent dat die regel wégvalt.
 * Wil je de standaardtekst terug, dan zet de portal de bekende tekst terug in
 * het veld — dat is zichtbaar en omkeerbaar, in plaats van dat een leeg veld
 * stilletjes iets anders gaat tonen dan er staat.
 */

/** Eén regel: pipes en regeleindes eruit (scheidingsteken in de printopdracht). */
function regel(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/[|\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, max);
}

function regels(v: unknown, maxRegels: number, maxLengte: number): string[] {
  const bron = Array.isArray(v)
    ? v
    : String(v ?? "").split(/\r?\n/); // een textarea levert één string met regeleindes
  return bron.map((r) => regel(r, maxLengte)).filter(Boolean).slice(0, maxRegels);
}

/**
 * Pakbon-invoer saneren. Geeft `null` als er niets bruikbaars in zat — de
 * aanroeper laat de bestaande instelling dan met rust.
 */
export function schoonPakbon(input: unknown): Settings["pakbon"] | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const b = input as Record<string, unknown>;
  const heeft = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  if (!["dankTekst", "retourKop", "retourRegels", "tweedeKop", "tweedeRegels", "toonSteden"].some(heeft)) return null;

  return {
    // Loopt over de volle breedte van de pakbon → mag langer dan een kolomregel.
    dankTekst: regel(b.dankTekst, 300),
    retourKop: regel(b.retourKop, 40),
    // 52 tekens is wat er in één servicekolom past bij de gebruikte puntgrootte.
    retourRegels: regels(b.retourRegels, 12, 52),
    tweedeKop: regel(b.tweedeKop, 40),
    tweedeRegels: regels(b.tweedeRegels, 12, 52),
    toonSteden: b.toonSteden === undefined ? true : Boolean(b.toonSteden),
  };
}
