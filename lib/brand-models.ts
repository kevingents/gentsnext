/**
 * De vaste GENTS-merkmodellen (blob-URL's) die als FASHN `face_reference` dienen.
 * Eén bron: stond eerder gedupliceerd in generate-pakken-media en
 * generate-product-media, waardoor het merkgezicht per script uit elkaar kon lopen.
 * Leeg laten = FASHN kiest zelf een model.
 */
export const MODEL_REFS: string[] = [
  "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-a.jpg",
  "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-b.jpg",
  "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-c.jpg",
  "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-d.jpg",
  "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-e.jpg",
];

/** Het merkmodel voor productindex `i` — geroteerd, zodat de catalogus niet één gezicht is. */
export function modelRefFor(i: number): string | null {
  return MODEL_REFS.length ? MODEL_REFS[i % MODEL_REFS.length] : null;
}
