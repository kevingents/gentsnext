/**
 * lib/retour-instellingen.js — de retour-instellingen valideren die uit de
 * portal komen (Instellingen → Retouren).
 *
 * Kevin, 13 aug: "retourkosten moeten we zelf kunnen instellen bij site
 * instellingen". Het bedrag is geen dood getal: het staat via `returnConfig` in
 * de retourflow, op de PDP, in de klantenservice-tekst, op de pakbon en in de
 * klantmails. Eén keer zetten verandert ze allemaal tegelijk — en precies daarom
 * mag er geen onzin doorheen.
 *
 * Bewust een los JS-bestand zonder Next-imports zodat `node --test` erbij kan
 * (patroon van lib/ab-regels.js): dit is de grens tussen een invoerveld en wat
 * we een klant in rekening brengen.
 *
 * Twee grenzen die geen smaakkwestie zijn:
 *  · `windowDays` kan niet onder de 14. Dat is de wettelijke bedenktijd bij
 *    verkoop op afstand; een veld waarmee je 7 kunt typen is een veld waarmee je
 *    de winkel in overtreding brengt. Hoger mag wel — ruimer dan de wet is een
 *    belofte, geen probleem.
 *  · `dhlReturnCostCents` is geklemd op € 20. Een verschoven komma (79400 in
 *    plaats van 794) mag geen € 794 aan retourkosten van een terugbetaling
 *    afhalen.
 *
 * Klemmen, niet weigeren — behalve bij een leeg of onleesbaar veld: dan blijft
 * de huidige waarde staan, zodat een half ingevuld formulier nooit stilletjes
 * een instelling op nul zet.
 */

/**
 * @typedef {object} ReturnConfig
 * @property {number}  windowDays
 * @property {number}  dhlReturnCostCents
 * @property {boolean} freeOnCredit
 * @property {number}  signalMinReturns
 * @property {number}  signalMinRatePct
 * @property {number}  signalFastDays
 */

/** De wettelijke bedenktijd bij verkoop op afstand — harde ondergrens. */
export const WETTELIJKE_BEDENKTIJD_DAGEN = 14;
/** Bovengrens op de retourkosten; vangt een verschoven komma. */
export const MAX_RETOURKOSTEN_CENTS = 2000;

function geheel(waarde, huidig, min, max) {
  /* Eerst het type, dán Number(). `Number("")` en `Number(null)` zijn allebei 0,
     dus een leeggemaakt invoerveld zou anders "retourkosten € 0,00" betekenen —
     een instelling die je stil weggooit door 'm leeg te laten. */
  if (typeof waarde !== "number" && typeof waarde !== "string") return huidig;
  if (typeof waarde === "string" && waarde.trim() === "") return huidig;
  const n = Number(waarde);
  if (!Number.isFinite(n)) return huidig;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * @param {unknown} input Wat de portal stuurt.
 * @param {ReturnConfig} huidig De opgeslagen instellingen.
 * @returns {ReturnConfig | null} null = niets bruikbaars meegestuurd.
 */
export function schoonReturnConfig(input, huidig) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const rc = /** @type {Record<string, unknown>} */ (input);
  // Op de HUIDIGE waarden gestapeld: updateSettings merget ondiep, dus een
  // deel-object zou de rest van de retour-instellingen wissen.
  return {
    ...huidig,
    windowDays: geheel(rc.windowDays, huidig.windowDays, WETTELIJKE_BEDENKTIJD_DAGEN, 365),
    dhlReturnCostCents: geheel(rc.dhlReturnCostCents, huidig.dhlReturnCostCents, 0, MAX_RETOURKOSTEN_CENTS),
    freeOnCredit: rc.freeOnCredit === undefined ? huidig.freeOnCredit : Boolean(rc.freeOnCredit),
    signalMinReturns: geheel(rc.signalMinReturns, huidig.signalMinReturns, 1, 1000),
    signalMinRatePct: geheel(rc.signalMinRatePct, huidig.signalMinRatePct, 1, 100),
    signalFastDays: geheel(rc.signalFastDays, huidig.signalFastDays, 1, 365),
  };
}
