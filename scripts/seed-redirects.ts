import "@/lib/load-env";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { normPath, type Redirect } from "@/lib/redirects";

/**
 * Bootstrap voor de Shopify→Next URL-migratie. Vult de portal-beheerbare redirects
 * (app_settings.redirects) met (1) de vaste patroon-redirects voor paden die
 * verschillen, en (2) optioneel Shopify's eigen redirect-export (CSV: "Redirect from","Redirect to").
 * Bestaande regels blijven LEIDEND (handmatige edits worden niet overschreven) —
 * alleen ontbrekende sources worden toegevoegd. Idempotent.
 *
 *   npm run seed:redirects                      # alleen de patronen
 *   npm run seed:redirects -- shopify.csv       # + Shopify-export mergen
 *
 * NB: /products, /collections, /pages matchen Shopify 1-op-1 (handles behouden) →
 * GEEN redirect nodig. Dit dekt alleen de afwijkende paden.
 */

const ID = "redirects";

const PATTERNS: Redirect[] = [
  { source: "/cart", target: "/winkelwagen", status: 301, active: true },
  { source: "/search", target: "/zoeken", status: 301, active: true },
  { source: "/blogs/*", target: "/blog", status: 301, active: true }, // oude Shopify-blog → AI-stijlgids-hub
  // GEEN /account/login of /account/register → /account: de nieuwe site HEEFT een
  // eigen loginpagina, en die redirect botste met de auth-guard (uitgelogd → /account/login)
  // = oneindige lus. De redirect-matcher slaat /account* nu sowieso over (PROTECTED_PREFIXES).
];

function splitCsvLine(line: string): string[] {
  const res: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === "," && !q) { res.push(cur); cur = ""; }
    else cur += c;
  }
  res.push(cur);
  return res;
}

function parseCsv(text: string): Redirect[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const start = /redirect from/i.test(lines[0]) ? 1 : 0;
  const out: Redirect[] = [];
  for (let i = start; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const from = (cols[0] || "").trim();
    const to = (cols[1] || "").trim();
    if (!from || !to) continue;
    const source = normPath(from);
    const target = /^https?:\/\//i.test(to) ? to.slice(0, 400) : normPath(to);
    if (!source || source === "/" || target === source) continue;
    out.push({ source, target, status: 301, active: true });
  }
  return out;
}

async function main() {
  const db = getDb();
  const rows = await db.select().from(appSettings).where(eq(appSettings.id, ID)).limit(1);
  const existing: Redirect[] = Array.isArray((rows[0]?.data as { list?: Redirect[] })?.list) ? (rows[0]!.data as { list: Redirect[] }).list : [];
  const bySource = new Map(existing.map((r) => [normPath(r.source), r]));

  const csvPath = process.argv[2];
  let fromCsv: Redirect[] = [];
  if (csvPath) {
    try { fromCsv = parseCsv(readFileSync(csvPath, "utf8")); }
    catch (e) { console.error("CSV lezen mislukt:", (e as Error).message); }
  }

  let added = 0;
  for (const r of [...fromCsv, ...PATTERNS]) {
    const key = normPath(r.source);
    if (!bySource.has(key)) { bySource.set(key, { ...r, source: key }); added++; }
  }
  const list = [...bySource.values()];
  await db.insert(appSettings).values({ id: ID, data: { list }, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: appSettings.id, set: { data: { list }, updatedAt: sql`now()` } });
  console.log(`Redirects: ${existing.length} bestaand · ${fromCsv.length} uit CSV · +${added} toegevoegd → ${list.length} totaal.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
