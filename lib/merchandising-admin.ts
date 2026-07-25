import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { CATEGORIES, categoryBySlug } from "@/lib/categories";
import { getCollectionByHandle, getProductsByHandles, listCollections } from "@/lib/catalog";
import { pinKey, type PinContextKind } from "@/lib/merchandising";
import { clearSettingsCache } from "@/lib/settings";

/**
 * Beheerlaag voor "Uitgelicht" (merchandising-pins) in de Site-studio.
 *
 * De pins zelf blijven in de settings-store (app_settings.global →
 * merchandisingPins), één bron van waarheid; dit bestand schrijft daar gericht
 * één sleutel in (savePinsForContext) en voegt verder toe wat de BEHEERDER nodig
 * heeft om een verantwoorde keuze te maken:
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

/** Zelfde plafond als lib/merchandising hanteert bij het lezen van de pins. */
const MAX_PINS = 24;

/**
 * Schrijft de pins van ÉÉN context weg zonder de rest van de instellingen aan te
 * raken. setMerchandisingPins in lib/merchandising bouwt de nieuwe waarde op uit
 * getSettings() — een module-cache van 30 seconden — en updateSettings schrijft
 * daarna de VOLLEDIGE app_settings-rij 'global' terug. Een instelling die een
 * collega (of dezelfde beheerder in een ander tabblad) net via Instellingen
 * wijzigde, zit niet in die cache en wordt bij het pinnen zonder melding
 * teruggedraaid. Hier muteren we daarom in SQL alleen data->'merchandisingPins'
 * en daarbinnen alleen deze sleutel; de rest van de rij blijft precies zoals hij
 * op dat moment in de database staat.
 */
export async function savePinsForContext(key: string, handles: string[]): Promise<string[]> {
  const clean = [...new Set((handles || []).map((h) => String(h || "").trim()).filter(Boolean))].slice(0, MAX_PINS);
  const currentPins = sql`coalesce(app_settings.data->'merchandisingPins', '{}'::jsonb)`;
  // Lege lijst = pin-config voor deze context weghalen (zelfde gedrag als voorheen).
  const nextPins = clean.length
    ? sql`${currentPins} || ${JSON.stringify({ [key]: clean })}::jsonb`
    : sql`${currentPins} - ${key}::text`;
  const db = getDb();
  await db.execute(sql`
    insert into app_settings (id, data, updated_at)
    values ('global', ${JSON.stringify({ merchandisingPins: clean.length ? { [key]: clean } : {} })}::jsonb, now())
    on conflict (id) do update
      set data = jsonb_set(coalesce(app_settings.data, '{}'::jsonb), '{merchandisingPins}', ${nextPins}, true),
          updated_at = now()`);
  // De leescache van lib/settings zou anders tot 30s de oude pins blijven serveren.
  clearSettingsCache();
  return clean;
}

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

/** Uitkomst per handle: doet deze pin iets op de gekozen winkelpagina? */
export type PinCheck = { handle: string; ok: boolean; reason?: string };

/**
 * Controleert of een handle daadwerkelijk OP de winkelpagina van deze context
 * verschijnt. Nodig omdat een pin niets toevoegt: hij is alleen een ORDER BY
 * binnen de resultaten van de PLP (lib/catalog → buildPlpOrder). Zit het product
 * niet in de categorie/collectie, of valt het buiten de zichtbaarheidsregel
 * (actief + foto + voorraad + primaire kleur), dan gebeurt er domweg niets —
 * terwijl de studio wél "staat bovenaan" meldde. Dat moet de beheerder zien.
 */
export async function checkPinsInContext(
  kind: PinContextKind,
  slug: string,
  handles: string[],
): Promise<PinCheck[]> {
  const list = [...new Set(handles.map((h) => String(h || "").trim()).filter(Boolean))];
  if (!list.length) return [];

  const hoofdgroep = kind === "categorie" ? categoryBySlug(slug)?.hoofdgroep || "" : "";
  const collection = kind === "collection" ? await getCollectionByHandle(slug) : null;
  // Onbekende context (verwijderde collectie of categorie): niets zinnigs te
  // zeggen — de editor waarschuwt daar al apart over.
  if (kind === "categorie" ? !hoofdgroep : !collection) return list.map((h) => ({ handle: h, ok: true }));

  const inContext =
    kind === "categorie"
      ? sql`p.attributes ->> 'hoofdgroep_omschrijving' = ${hoofdgroep}`
      : sql`exists (select 1 from product_collections pc where pc.product_id = p.id and pc.collection_id = ${collection!.id})`;

  try {
    const db = getDb();
    const rows = await db.execute<{ handle: string; zichtbaar: boolean; in_context: boolean }>(sql`
      select p.handle,
             (p.status = 'active' and p.has_image and p.in_stock and p.is_group_primary) as zichtbaar,
             (${inContext}) as in_context
      from products p
      where p.handle in (${sql.join(list.map((h) => sql`${h}`), sql`, `)})
    `);
    const byHandle = new Map(rows.rows.map((r) => [r.handle, r]));
    return list.map((h) => {
      const r = byHandle.get(h);
      if (!r) return { handle: h, ok: false, reason: "staat niet meer in de catalogus" };
      if (!r.in_context) {
        return {
          handle: h,
          ok: false,
          reason: kind === "categorie" ? "zit niet in deze categorie" : "zit niet in deze collectie",
        };
      }
      if (!r.zichtbaar) {
        return { handle: h, ok: false, reason: "staat niet op de winkelpagina (uitverkocht, geen foto, of een kleurvariant)" };
      }
      return { handle: h, ok: true };
    });
  } catch {
    // Een controlefout mag het beheer niet blokkeren: dan maar geen oordeel.
    return list.map((h) => ({ handle: h, ok: true }));
  }
}
