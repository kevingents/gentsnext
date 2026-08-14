import { getContentDoc, setContentDoc } from "@/lib/content-store";
import { SMOKING_ROLES, type SmokingRole } from "@/lib/smoking-korting";

/**
 * Bundel-beheer voor de nieuwe site — bewerkbaar via /site, naast Looks.
 *
 * Hiervóór kwam de samenstelling uit de portal-instellingen van storegents.
 * Dat werkte, maar het betekende dat je voor de nieuwe site in de oude portal
 * moest zijn, en dat een nieuwe bundel aanmaken niet kon zonder mij. Nu leeft
 * de bron hier, in dezelfde content-store als de looks (`setContentDoc`), dus
 * een wijziging is direct live: die functie invalideert zijn eigen cache-tag.
 *
 * `getSmokingBundles()` valt terug op de portal-config zolang hier niets is
 * opgeslagen. Zo blijft de bestaande smoking staan tot iemand hem in /site
 * bewerkt, in plaats van dat de pagina leeg is op het moment van overzetten.
 */

const KEY = "bundles";

export type BundelRol = { rol: SmokingRole; handles: string[] };

export type Bundel = {
  id: string;
  naam: string;
  subtitel: string;
  badge: string;
  /** Vaste pakketprijs in euro's. */
  prijs: number;
  rollen: BundelRol[];
  /** Uit = onzichtbaar op de site, zonder 'm weg te gooien. */
  actief: boolean;
  updatedAt?: string;
};

export type BundelDoc = {
  heading: string;
  intro: string;
  knoptekst: string;
  bundels: Bundel[];
  extras: { handle: string; label: string; omschrijving: string; kleur: string }[];
};

const clean = (v: unknown) => String(v ?? "").trim();
const lc = (v: unknown) => clean(v).toLowerCase();

function num(v: unknown, d: number): number {
  if (v == null || String(v).trim() === "") return d;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : d;
}

/** Handles opschonen: kleine letters, ontdubbeld, lege eruit. */
function handles(list: unknown): string[] {
  const uit: string[] = [];
  const gezien = new Set<string>();
  for (const h of Array.isArray(list) ? list : []) {
    const k = lc(h);
    if (!k || gezien.has(k)) continue;
    gezien.add(k);
    uit.push(k);
  }
  return uit;
}

export function normalizeBundel(raw: unknown, index = 0): Bundel {
  const b = (raw ?? {}) as Record<string, unknown>;
  const perRol = new Map<string, string[]>();
  for (const r of Array.isArray(b.rollen) ? (b.rollen as Record<string, unknown>[]) : []) {
    const rol = lc(r?.rol);
    if ((SMOKING_ROLES as readonly string[]).includes(rol)) perRol.set(rol, handles(r?.handles));
  }
  return {
    /* De id zit in de groupId van elke winkelwagenregel en bepaalt daar welke
       pakketprijs geldt. Hem hernoemen zou lopende manden hun korting kosten,
       dus hij wordt afgeleid van de naam en daarna niet meer aangeraakt. */
    id: lc(b.id) || lc(b.naam).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `bundel-${index + 1}`,
    naam: clean(b.naam) || `Bundel ${index + 1}`,
    subtitel: clean(b.subtitel),
    badge: clean(b.badge),
    prijs: Math.max(0, num(b.prijs, 0)),
    rollen: SMOKING_ROLES.map((rol) => ({ rol, handles: perRol.get(rol) ?? [] })),
    actief: b.actief !== false,
    updatedAt: clean(b.updatedAt) || undefined,
  };
}

/**
 * Bruikbaar = elke kernrol heeft minstens één artikel én er staat een prijs.
 * Een half ingevulde bundel tonen levert een stap op die vastloopt, of erger:
 * een pakketprijs van nul.
 */
export function bundelCompleet(b: Bundel): boolean {
  if (!b.actief || !(b.prijs > 0)) return false;
  return SMOKING_ROLES.every((rol) => (b.rollen.find((r) => r.rol === rol)?.handles.length ?? 0) > 0);
}

export function normalizeBundelDoc(raw: unknown): BundelDoc {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    heading: clean(d.heading),
    intro: clean(d.intro),
    knoptekst: clean(d.knoptekst),
    bundels: (Array.isArray(d.bundels) ? d.bundels : []).map(normalizeBundel),
    extras: (Array.isArray(d.extras) ? (d.extras as Record<string, unknown>[]) : [])
      .map((e) => ({
        handle: lc(e?.handle),
        label: clean(e?.label),
        omschrijving: clean(e?.omschrijving),
        kleur: clean(e?.kleur),
      }))
      .filter((e) => e.handle),
  };
}

/** Wat er in /site is opgeslagen. `null` = nog nooit bewerkt. */
export async function getBundelDoc(): Promise<BundelDoc | null> {
  const doc = await getContentDoc<BundelDoc>(KEY);
  if (!doc || !Array.isArray(doc.bundels) || !doc.bundels.length) return null;
  return normalizeBundelDoc(doc);
}

export async function saveBundelDoc(input: unknown): Promise<BundelDoc> {
  const doc = normalizeBundelDoc(input);
  await setContentDoc(KEY, doc);
  return doc;
}

/** Eén bundel toevoegen of bijwerken (upsert op id). */
export async function saveBundel(bundel: unknown): Promise<BundelDoc> {
  const huidig = (await getBundelDoc()) ?? { heading: "", intro: "", knoptekst: "", bundels: [], extras: [] };
  const nieuw = { ...normalizeBundel(bundel), updatedAt: new Date().toISOString() };
  const i = huidig.bundels.findIndex((b) => b.id === nieuw.id);
  if (i >= 0) huidig.bundels[i] = nieuw;
  else huidig.bundels.push(nieuw);
  return saveBundelDoc(huidig);
}

export async function deleteBundel(id: string): Promise<BundelDoc> {
  const huidig = await getBundelDoc();
  if (!huidig) return { heading: "", intro: "", knoptekst: "", bundels: [], extras: [] };
  return saveBundelDoc({ ...huidig, bundels: huidig.bundels.filter((b) => b.id !== lc(id)) });
}

export const BUNDEL_CONTENT_KEY = KEY;
