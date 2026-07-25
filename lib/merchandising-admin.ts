import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { CATEGORIES } from "@/lib/categories";
import { getProductsByHandles, listCollections } from "@/lib/catalog";
import { pinKey, type PinContextKind } from "@/lib/merchandising";

/**
 * Beheerlaag voor "Uitgelicht" (merchandising-pins) in de Site-studio.
 *
 * De pins zelf blijven in lib/merchandising (settings-store, één bron van
 * waarheid). Dit bestand voegt alleen toe wat de BEHEERDER nodig heeft om een
 * verantwoorde keuze te maken:
 *
 *  1. "gepind sinds": wanneer een pin gezet is. Een pin overrulet in de
 *     "Aanbevolen"-sort ALLE gedragssignalen (populariteit, maat, smaak), dus
 *     een pin die er al maanden staat drukt maandenlang weg wat klanten
 *     aantoonbaar kiezen. Zonder datum is dat onzichtbaar. Bewaard in een eigen
 *     app_settings-rij ("merchandising_pin_log") — geen migratie nodig en de
 *     globale instellingen blijven ongemoeid. Het log is aanvullend: als het
 *     schrijven faalt, blijft de pin zelf gewoon staan.
 *  2. Handles → productkaart (titel + miniatuur), inclusief handles die niet
 *     meer in de catalogus zitten, zodat die opruimbaar zijn i.p.v. onzichtbaar.
 */

export type PinItem = {
  handle: string;
  title: string;
  imageUrl: string;
  priceCents: number | null;
  /** false = handle staat wél gepind maar zit niet (meer) in de catalogus. */
  known: boolean;
};

export type PinContext = {
  /** Sleutel in de settings-store: `${kind}:${slug}`. */
  key: string;
  kind: PinContextKind;
  slug: string;
  label: string;
  /** Kop in de keuzelijst ("Categorieën" / "Collecties" / "Onbekende context"). */
  group: string;
};

/** pin-sleutel → product-handle → ISO-datum waarop de pin gezet is. */
export type PinSinceMap = Record<string, Record<string, string>>;

const LOG_ID = "merchandising_pin_log";

function normalizeSince(raw: unknown): PinSinceMap {
  const out: PinSinceMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const inner: Record<string, string> = {};
    for (const [handle, iso] of Object.entries(val as Record<string, unknown>)) {
      if (typeof iso === "string" && iso.trim()) inner[handle] = iso;
    }
    if (Object.keys(inner).length) out[key] = inner;
  }
  return out;
}

/** Alle "gepind sinds"-datums. Leeg bij een leesfout — de pagina blijft werken. */
export async function getPinSinceMap(): Promise<PinSinceMap> {
  try {
    const db = getDb();
    const rows = await db.select().from(appSettings).where(eq(appSettings.id, LOG_ID)).limit(1);
    return normalizeSince(rows[0]?.data);
  } catch {
    return {};
  }
}

/**
 * Werkt het "gepind sinds"-log bij na een opslag: bestaande pins houden hun
 * oorspronkelijke datum (anders zou elke volgordewijziging de ouderdom wissen),
 * nieuwe pins krijgen nu, weggehaalde pins verdwijnen uit het log.
 */
export async function recordPinsSince(key: string, handles: string[]): Promise<Record<string, string>> {
  const now = new Date().toISOString();
  try {
    const current = await getPinSinceMap();
    const previous = current[key] || {};
    const next: Record<string, string> = {};
    for (const h of handles) next[h] = previous[h] || now;
    const map: PinSinceMap = { ...current };
    if (Object.keys(next).length) map[key] = next;
    else delete map[key];
    const db = getDb();
    await db
      .insert(appSettings)
      .values({ id: LOG_ID, data: map, updatedAt: sql`now()` })
      .onConflictDoUpdate({ target: appSettings.id, set: { data: map, updatedAt: sql`now()` } });
    return next;
  } catch {
    // Log-schrijffout mag de pin-opslag niet ongedaan maken; de UI toont dan
    // "datum onbekend" tot de volgende geslaagde schrijfactie.
    return {};
  }
}

/**
 * Handles → productkaarten, in dezelfde volgorde als de invoer. Onbekende
 * handles komen terug met `known: false` zodat de beheerder ze kan weghalen.
 */
export async function resolvePinItems(handles: string[]): Promise<PinItem[]> {
  const list = [...new Set(handles.map((h) => String(h || "").trim()).filter(Boolean))];
  if (!list.length) return [];
  // getProductsByHandles kapt af op 60 handles per aanroep → in blokken ophalen.
  const chunks: string[][] = [];
  for (let i = 0; i < list.length; i += 50) chunks.push(list.slice(i, i + 50));
  const cards = (await Promise.all(chunks.map((c) => getProductsByHandles(c)))).flat();
  const byHandle = new Map(cards.map((c) => [c.handle, c]));
  return list.map((h) => {
    const c = byHandle.get(h);
    return c
      ? { handle: h, title: c.title, imageUrl: c.imageUrl, priceCents: c.minPriceCents, known: true }
      : { handle: h, title: h, imageUrl: "", priceCents: null, known: false };
  });
}

/**
 * Alle contexten waarin gepind kan worden: de vaste categorieën + de
 * collecties. Sleutels die wél pins hebben maar bij geen bestaande context
 * horen (bv. een verwijderde collectie) komen er als "Onbekende context" bij,
 * zodat verweesde pins zichtbaar en opruimbaar blijven.
 */
export async function listPinContexts(existingKeys: string[]): Promise<PinContext[]> {
  const collections = await listCollections();
  const contexts: PinContext[] = [
    ...CATEGORIES.map((c) => ({
      key: pinKey("categorie", c.slug),
      kind: "categorie" as PinContextKind,
      slug: c.slug,
      label: c.label,
      group: "Categorieën",
    })),
    ...collections.map((c) => ({
      key: pinKey("collection", c.handle),
      kind: "collection" as PinContextKind,
      slug: c.handle,
      label: c.title,
      group: "Collecties",
    })),
  ];
  const known = new Set(contexts.map((c) => c.key));
  for (const key of existingKeys) {
    if (known.has(key)) continue;
    const idx = key.indexOf(":");
    const kind: PinContextKind = key.slice(0, idx) === "collection" ? "collection" : "categorie";
    const slug = idx >= 0 ? key.slice(idx + 1) : key;
    contexts.push({ key, kind, slug, label: slug || key, group: "Onbekende context" });
  }
  return contexts;
}
