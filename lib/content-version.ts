/**
 * Versiestempel van een content-document (pagina's, menu, gelegenheden).
 *
 * Waarom: diezelfde documenten worden door TWEE beheerkanten volledig
 * overschreven — de Site-studio in de webshop (/account/*) en het portal-venster
 * (/api/studio/site/*). Beide sturen de complete lijst vanuit een momentopname
 * die bij het openen van het scherm is gemaakt. Zonder controle wist de laatste
 * opslag stilzwijgend het werk van de ander (of van een tweede tabblad).
 *
 * De stempel is een goedkope hash van het opgeslagen document. Bewust GEEN extra
 * veld in de opslag: het opslagformaat blijft precies zoals het is, en beide
 * kanten kunnen de stempel op elk moment opnieuw uit de opslag afleiden.
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
