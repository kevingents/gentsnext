import { getStores } from "@/lib/stores";

/**
 * Slugs die /pages/[handle] al VÓÓR de eigen content-pagina's afhandelt
 * (vaste landings + winkelpagina's). Een content-pagina op zo'n slug zou
 * stilletjes onzichtbaar blijven — daarom weigeren we ze bij het opslaan en
 * tonen we ze in de Site-studio als "bezet".
 */
const FIXED = [
  "etiquette",
  "klantenservice",
  "service",
  "herroepingsformulier",
  "zakelijk",
  "students",
  "winkels",
  "uitvaartkleding",
  "trouw-afspraak",
];

/** Alle bezette slugs: vaste pagina's + elke winkelpagina. */
export function reservedPageSlugs(): string[] {
  const out = new Set(FIXED);
  try {
    for (const s of getStores()) if (s.pageHandle) out.add(String(s.pageHandle).toLowerCase());
  } catch {
    // winkeldata niet leesbaar → alleen de vaste lijst; nooit blokkerend.
  }
  return [...out].sort();
}

export function isReservedPageSlug(slug: string): boolean {
  return reservedPageSlugs().includes(String(slug || "").trim().toLowerCase());
}
