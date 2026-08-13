/**
 * Retourredenen — één canonieke lijst voor de klantflow én de statistieken.
 *
 * Waarom een vaste lijst en geen vrij tekstveld meer: het veld was optioneel en
 * vrij, dus de top-retourredenen in het portal-dashboard groepeerden op letterlijk
 * ingetikte zinnen ("te klein", "Te klein!!", "past niet echt"). Zes balkjes met
 * elk n=1 zeggen niets over de pasvorm van een artikel. Met een vaste keuze telt
 * elke retour mee in dezelfde bak.
 *
 * De DATABASE krijgt altijd het NL-label uit deze lijst — ook als de klant de site
 * in het Duits gebruikt. Anders splitst dezelfde reden zich per taal op in het
 * dashboard. Wat de klant ZIET komt uit de vertaalcatalogus (`key`), die de
 * nachtelijke vertaal-cron meeneemt.
 *
 * Bewust een los JS-bestand zonder Next-imports zodat `node --test` erbij kan
 * (zelfde patroon als lib/ab-regels.js): dit is de regel die bepaalt wat er in de
 * database belandt, en die hoort onder test te staan.
 *
 * @typedef {object} ReturnReason
 * @property {string}  code        Stabiele sleutel in de UI en op de draad; komt niet in de database.
 * @property {string}  label       Wat er in `returns.reason` belandt — en dus in de statistieken.
 * @property {string}  key         Sleutel in de vertaalcatalogus: wat de klant leest.
 * @property {boolean} [alteration] De vermaakservice kan hier vaak iets aan doen → toon de winkel-hint.
 * @property {boolean} [needsNote]  Zonder toelichting weten we nog niets → tekstveld verplicht.
 */

/** @type {ReadonlyArray<ReturnReason>} */
export const RETURN_REASONS = [
  { code: "te_groot", label: "Te groot", key: "retourneren.reason.teGroot", alteration: true },
  { code: "te_klein", label: "Te klein", key: "retourneren.reason.teKlein", alteration: true },
  { code: "lengte", label: "Mouw- of pijplengte klopt niet", key: "retourneren.reason.lengte", alteration: true },
  { code: "pasvorm", label: "Pasvorm of model staat me niet", key: "retourneren.reason.pasvorm", alteration: true },
  { code: "meerdere_maten", label: "Meerdere maten besteld om te passen", key: "retourneren.reason.meerdereMaten" },
  { code: "anders_dan_verwacht", label: "Anders dan verwacht (kleur of stof)", key: "retourneren.reason.andersDanVerwacht" },
  { code: "kwaliteit", label: "Kwaliteit valt tegen", key: "retourneren.reason.kwaliteit" },
  { code: "beschadigd", label: "Beschadigd of verkeerd geleverd", key: "retourneren.reason.beschadigd", needsNote: true },
  { code: "te_laat", label: "Te laat geleverd", key: "retourneren.reason.teLaat" },
  { code: "anders", label: "Andere reden", key: "retourneren.reason.anders", needsNote: true },
];

/**
 * Scheidingsteken tussen het vaste label en de vrije toelichting. De statistieken
 * groeperen op het deel ervóór (`split_part`), zodat een toelichting de telling
 * niet opnieuw versnippert. Geen enkel label mag dit teken zelf bevatten.
 */
export const REASON_NOTE_SEP = " — ";

const BY_CODE = new Map(RETURN_REASONS.map((r) => [r.code, r]));

/**
 * @param {string} code
 * @returns {ReturnReason | undefined}
 */
export function returnReason(code) {
  return BY_CODE.get(String(code || "").trim());
}

/**
 * Bouwt de regel die we opslaan: "<vast label>" of "<vast label> — <toelichting>".
 * Lege string = niet accepteren (onbekende code, of een verplichte toelichting die
 * ontbreekt). De aanroeper beslist wat dat betekent; `createReturn` weigert erop.
 *
 * @param {string} code
 * @param {string} [note]
 * @returns {string}
 */
export function canonicalReturnReason(code, note = "") {
  const reason = returnReason(code);
  if (!reason) return "";
  const toelichting = String(note || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (reason.needsNote && !toelichting) return "";
  return toelichting ? `${reason.label}${REASON_NOTE_SEP}${toelichting}` : reason.label;
}
