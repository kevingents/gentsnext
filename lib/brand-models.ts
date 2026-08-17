/**
 * De vaste GENTS-merkmodellen (blob-URL's) die als FASHN `face_reference` dienen.
 * Eén bron: stond eerder gedupliceerd in generate-pakken-media en
 * generate-product-media, waardoor het merkgezicht per script uit elkaar kon lopen.
 * Leeg laten = FASHN kiest zelf een model.
 */

export type BrandModel = { id: string; label: string; url: string };

/**
 * De modellen met een sleutel en een naam erbij, zodat de portal ze kan tonen en
 * je er één kunt kíezen ("maak dit beeld met model C"). De ID's zijn stabiel; het
 * label mag veranderen zonder dat een eerdere keuze ergens ongeldig wordt.
 *
 * Waarom niet portal-beheerbaar zoals de beeldthema's: een merkmodel is een
 * bestand dat geüpload en beoordeeld moet worden, geen tekstveld. Komt er een
 * zesde model bij, dan hoort dat een bewuste stap te zijn — niet iets wat je
 * tussen twee dropdowns in doet.
 */
export const BRAND_MODELS: BrandModel[] = [
  { id: "a", label: "Model A", url: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-a.jpg" },
  { id: "b", label: "Model B", url: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-b.jpg" },
  { id: "c", label: "Model C", url: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-c.jpg" },
  { id: "d", label: "Model D", url: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-d.jpg" },
  { id: "e", label: "Model E", url: "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-e.jpg" },
];

/** Alleen de URL's — bestaande aanroepers (de generatie-scripts) blijven werken. */
export const MODEL_REFS: string[] = BRAND_MODELS.map((m) => m.url);

/** Het merkmodel voor productindex `i` — geroteerd, zodat de catalogus niet één gezicht is. */
export function modelRefFor(i: number): string | null {
  return MODEL_REFS.length ? MODEL_REFS[i % MODEL_REFS.length] : null;
}

/** De URL achter een model-id, of "" als het id niet bestaat. */
export function modelRefById(id: string): string {
  return BRAND_MODELS.find((m) => m.id === id)?.url ?? "";
}
