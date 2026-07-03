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

const isWild = (s: string) => /\/\*+$/.test(String(s || ""));
const st = (s: 301 | 302) => (s === 302 ? 302 : 301);

/**
 * Beschermde app-routes die een portal/legacy-redirect NOOIT mag overrulen.
 * Fixt de redirect-lus die ontstond doordat een Shopify-erfenis-regel
 * `/account/login → /account` (301) botste met de auth-guard die uitgelogde
 * bezoekers juist naar `/account/login` (307) stuurt → inloggen onbereikbaar.
 * Deze paden zijn kern-functionaliteit (auth/afrekenen/mandje/API); een redirect
 * erop is per definitie een fout, dus we slaan matching ervoor onvoorwaardelijk over.
 */
const PROTECTED_PREFIXES = ["/account", "/afrekenen", "/winkelwagen", "/api"];
const isProtected = (p: string) => PROTECTED_PREFIXES.some((pre) => p === pre || p.startsWith(pre + "/"));

/**
 * Snelle lookup voor de middleware op het canonieke (locale-loze) pad. Ondersteunt
 * exacte regels én prefix-wildcards (source eindigt op `/*`):
 *   - `/blogs/*` → `/blog`        : alles onder /blogs naar de blog-hub
 *   - `/oud/*`   → `/nieuw/*`      : behoudt het restpad (/oud/x/y → /nieuw/x/y)
 * Exacte match wint van wildcard; bij meerdere wildcards wint de LANGSTE prefix.
 */
export async function matchRedirect(path: string): Promise<{ target: string; status: number } | null> {
  const p = normPath(path);
  if (p === "/" || isProtected(p)) return null;
  const list = await getRedirects();

  // 1. Exacte match (meest specifiek).
  const exact = list.find((r) => r.active && !isWild(r.source) && normPath(r.source) === p);
  if (exact) return { target: exact.target, status: st(exact.status) };

  // 2. Prefix-wildcard: langste prefix wint.
  let best: { r: Redirect; splat: string; len: number } | null = null;
  for (const r of list) {
    if (!r.active || !isWild(r.source)) continue;
    const prefix = normPath(r.source.replace(/\/\*+$/, ""));
    if (p === prefix || p.startsWith(prefix + "/")) {
      if (!best || prefix.length > best.len) best = { r, splat: p.slice(prefix.length), len: prefix.length };
    }
  }
  if (best) {
    const t = best.r.target;
    const target = isWild(t) ? normPath(t.replace(/\/\*+$/, "") + best.splat) : t;
    return { target, status: st(best.r.status) };
  }
  return null;
}
