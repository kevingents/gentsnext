import { getSettings, updateSettings } from "@/lib/settings";

/**
 * Merchandising-pins — handmatig uitgelichte producten die bovenaan de
 * "Aanbevolen"-sort van een PLP komen. Config leeft in de settings-store
 * (app_settings.global.merchandisingPins), beheerd vanuit de portal; nooit
 * hardcoded. Sleutel = `${kind}:${slug}` (categorie-slug of collectie-handle).
 */

export type PinContextKind = "categorie" | "collection";

const MAX_PINS = 24;

export function pinKey(kind: PinContextKind, slug: string): string {
  return `${kind}:${String(slug || "").trim().toLowerCase()}`;
}

/** De gepinde product-handles (in volgorde) voor een PLP-context; leeg als niets gepind is. */
export async function getMerchandisingPins(kind: PinContextKind, slug: string): Promise<string[]> {
  if (!slug) return [];
  const s = await getSettings();
  const arr = s.merchandisingPins?.[pinKey(kind, slug)];
  if (!Array.isArray(arr)) return [];
  return arr.filter((h): h is string => typeof h === "string" && h.trim().length > 0).slice(0, MAX_PINS);
}

/** Zet (overschrijft) de pins voor één context. Dedupt, trimt, begrenst op MAX_PINS. */
export async function setMerchandisingPins(kind: PinContextKind, slug: string, handles: string[]): Promise<string[]> {
  const key = pinKey(kind, slug);
  const clean = [...new Set((handles || []).map((h) => String(h || "").trim()).filter(Boolean))].slice(0, MAX_PINS);
  const current = await getSettings();
  const nextMap = { ...(current.merchandisingPins || {}) };
  if (clean.length) nextMap[key] = clean;
  else delete nextMap[key]; // lege lijst = pin-config voor die context weghalen
  await updateSettings({ merchandisingPins: nextMap });
  return clean;
}

/** Alle pin-configs (voor het portal-overzicht). */
export async function getAllMerchandisingPins(): Promise<Record<string, string[]>> {
  const s = await getSettings();
  return s.merchandisingPins || {};
}
