/**
 * Vaste merk-/banner-beelden — ALTIJD onze eigen producten (FASHN, gemaakt uit
 * echte productfoto's). Geen FAL/AI-verzonnen kleding, geen stock. Vanaf nu de
 * bron voor hero's/sfeerbeelden op content-, landings- en accountpagina's.
 *
 * lifestyle = echt product in een setting (breed/banner). model = echt product,
 * schone studio (voor kleinere sectie-tegels).
 */
const L = "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-lifestyle/";
const M = "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-models/";

export const VISUAL = {
  trouw: `${L}colbert-sjas-blauw.jpg`,
  formal: `${L}m-m-colbert-blend-zwart.jpg`,
  zakelijk: `${L}m-m-pantalon-blend-navy.jpg`,
  student: `${L}rokstrik-zelfstrik-pique.jpg`,
  polo: `${L}shirt-polo-2-tone-lichtgroen.jpg`,
  country: `${L}coat-windvanger-blauw.jpg`,
  knit: `${L}turtle-neck-navy-3.jpg`,
};

/** Onderwerp → passend echt-product-bannerbeeld (lifestyle in setting). */
export function heroVisualFor(text: string): string {
  const t = (text || "").toLowerCase();
  if (/trouw|bruiloft|huwelijk|wedding|getrouwd/.test(t)) return VISUAL.trouw;
  if (/uitvaart|rouw|condoleance|begrafenis|funeral/.test(t)) return VISUAL.formal;
  if (/gala|black.?tie|white.?tie|smoking|rokkostuum|jacquet|verenig|corps|diner|etiquette|dresscode/.test(t)) return VISUAL.formal;
  if (/student/.test(t)) return VISUAL.student;
  if (/polo|zomer|summer/.test(t)) return VISUAL.polo;
  if (/zakelijk|business|sollicit|interview|werk|kantoor/.test(t)) return VISUAL.zakelijk;
  if (/trui|knit|jas|coat|herfst|winter|country/.test(t)) return VISUAL.country;
  return VISUAL.trouw;
}

/** Echt-product modelfoto's (schone studio) voor sectie-tegels in artikelen. */
export const SECTION_VISUALS = [
  `${M}colbert-sjas-blauw-model.jpg`,
  `${M}m-m-colbert-blend-zwart-model.jpg`,
  `${M}m-m-colbert-blend-grijs-model.jpg`,
  `${M}colbert-ruit-katoen-linnen-lichtblauw-model.jpg`,
  `${M}jas-smoking-punt-pv-zwart-model.jpg`,
  `${M}m-m-colbert-wol-blauw-model.jpg`,
];
