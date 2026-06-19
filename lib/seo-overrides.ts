import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";

/**
 * Portal-beheerbare SEO-overrides per pad. Overschrijft de automatisch bepaalde
 * meta-titel/omschrijving (en optioneel noindex) van een pagina zónder code/
 * redeploy. Bron: app_settings-rij `seoOverrides` (map pad → override). 30s cache.
 *
 * Pad = canoniek pad zonder taal-prefix, bv. "/products/<handle>" of
 * "/categorie/<slug>". De storefront leest dit in generateMetadata.
 */
export type SeoOverride = { title?: string; description?: string; noindex?: boolean };
type Store = Record<string, SeoOverride>;

const ID = "seoOverrides";
let _cache: Store | null = null;
let _at = 0;
const TTL = 30_000;

const norm = (path: string) => "/" + String(path || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");

async function read(): Promise<Store> {
  if (_cache && Date.now() - _at < TTL) return _cache;
  try {
    const db = getDb();
    const rows = await db.select().from(appSettings).where(eq(appSettings.id, ID)).limit(1);
    _cache = (rows[0]?.data ?? {}) as Store;
  } catch {
    _cache = {};
  }
  _at = Date.now();
  return _cache;
}

async function write(s: Store): Promise<void> {
  const db = getDb();
  await db
    .insert(appSettings)
    .values({ id: ID, data: s, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: appSettings.id, set: { data: s, updatedAt: sql`now()` } });
  _cache = s;
  _at = Date.now();
}

/** Snelle read voor generateMetadata. */
export async function getSeoOverride(path: string): Promise<SeoOverride | null> {
  const s = await read();
  return s[norm(path)] ?? null;
}

export async function getAllSeoOverrides(): Promise<Array<{ path: string } & SeoOverride>> {
  const s = await read();
  return Object.entries(s)
    .map(([path, v]) => ({ path, ...v }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function setSeoOverride(path: string, patch: SeoOverride): Promise<void> {
  const p = norm(path);
  if (!p || p === "/") return;
  const s = { ...(await read()) };
  const entry: SeoOverride = {};
  const title = patch.title !== undefined ? String(patch.title).trim().slice(0, 200) : s[p]?.title;
  const description = patch.description !== undefined ? String(patch.description).trim().slice(0, 320) : s[p]?.description;
  const noindex = patch.noindex !== undefined ? Boolean(patch.noindex) : s[p]?.noindex;
  if (title) entry.title = title;
  if (description) entry.description = description;
  if (noindex) entry.noindex = true;
  if (!entry.title && !entry.description && !entry.noindex) delete s[p];
  else s[p] = entry;
  await write(s);
}

export async function deleteSeoOverride(path: string): Promise<void> {
  const s = { ...(await read()) };
  delete s[norm(path)];
  await write(s);
}

/** Past een override toe op een (Next.js) Metadata-object. Mutatie + return. */
export function applySeoOverride<T extends { title?: unknown; description?: unknown; robots?: unknown }>(
  meta: T,
  ov: SeoOverride | null,
): T {
  if (!ov) return meta;
  if (ov.title) meta.title = ov.title;
  if (ov.description) meta.description = ov.description;
  if (ov.noindex) (meta as { robots?: unknown }).robots = { index: false, follow: true };
  return meta;
}
