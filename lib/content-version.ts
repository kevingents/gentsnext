/**
 * Versiestempel van een content-document (pagina's, menu, gelegenheden).
 *
 * Waarom: die documenten worden altijd in hun geheel overschreven. De portal
 * stuurt de complete lijst vanuit een momentopname die bij het openen van het
 * scherm is gemaakt, dus zonder controle wist de laatste opslag stilzwijgend
 * het werk van wie er net vóór was — een collega, of gewoon je eigen tweede
 * tabblad. Niemand krijgt een foutmelding; het werk is er simpelweg niet meer.
 *
 * Dit begon als bescherming tegen twee beheerkanten (de Site-studio op
 * /account/* naast de portal). Die studio is opgeheven, maar de bescherming
 * niet overbodig: één beheerkant met meerdere gebruikers botst net zo hard.
 *
 * De stempel is een goedkope hash van het document zoals de GET het teruggaf.
 * Bewust GEEN extra veld in de opslag: het opslagformaat blijft precies zoals
 * het is, en beide kanten kunnen de stempel op elk moment opnieuw afleiden.
 */
export function docVersion(doc: unknown): string {
  const json = JSON.stringify(doc ?? null) ?? "null";
  // FNV-1a: klein, stabiel en zonder afhankelijkheden (draait ook in de browser).
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${json.length.toString(36)}-${h.toString(36)}`;
}

/** Melding bij een botsing — één tekst, zodat alle schermen hetzelfde zeggen. */
export const CONFLICT_MESSAGE =
  "Iemand anders (of een ander tabblad) heeft dit intussen opgeslagen. Vernieuw de pagina en voer je wijziging opnieuw door — anders zou je het werk van de ander wissen.";
