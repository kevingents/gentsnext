import { neon } from "@neondatabase/serverless";

/**
 * Portal-beheerbare redirects. EDGE-SAFE leeslaag voor de middleware: gebruikt
 * de Neon HTTP-client direct (géén drizzle) + een 30s module-cache, en is
 * fail-soft (een DB-hapering breekt de routing nooit). De schrijfkant zit in het
 * studio-endpoint (Node). Bron: app_settings-rij `redirects` ({ list: [...] }).
 */
export type Redirect = { source: string; target: string; status: 301 | 302; active: boolean };

let _sql: ReturnType<typeof neon> | null = null;
function client() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL || "");
  return _sql;
}

export const normPath = (p: string) => "/" + String(p || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");

let _cache: Redirect[] | null = null;
let _at = 0;
const TTL = 30_000;

export async function getRedirects(): Promise<Redirect[]> {
  if (_cache && Date.now() - _at < TTL) return _cache;
  try {
    const rows = (await client()`select data from app_settings where id = 'redirects' limit 1`) as { data: { list?: Redirect[] } }[];
    const list = rows[0]?.data?.list;
    _cache = Array.isArray(list) ? list : [];
    _at = Date.now();
  } catch {
    if (!_cache) _cache = [];
  }
  return _cache;
}

/** Snelle lookup voor de middleware op het canonieke (locale-loze) pad. */
export async function matchRedirect(path: string): Promise<{ target: string; status: number } | null> {
  const p = normPath(path);
  if (p === "/") return null;
  const list = await getRedirects();
  const hit = list.find((r) => r.active && normPath(r.source) === p);
  if (!hit) return null;
  return { target: hit.target, status: hit.status === 302 ? 302 : 301 };
}
