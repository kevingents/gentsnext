import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { events } from "@/db/schema";

/**
 * Eigen storefront-analytics. Schrijft anonieme events (geen PII) en levert
 * aggregaties voor het dashboard: populairste producten, zoektermen, zoekopdrachten
 * zonder resultaat (afhakers), en de funnel view → cart → checkout → aankoop.
 */

export type IncomingEvent = {
  sessionId?: string;
  type: string;
  path?: string;
  handle?: string;
  query?: string;
  valueCents?: number;
  props?: Record<string, unknown>;
};

const ALLOWED = new Set([
  "pageview", "product_view", "search", "search_no_results", "filter",
  "add_to_cart", "cart_view", "checkout_start", "purchase", "stock_notify", "wishlist_add",
  // Klantafspraken: server-side gelogd bij een geslaagde boeking (type+winkel in props).
  "afspraak_geboekt",
]);

export async function recordEvents(list: IncomingEvent[]): Promise<number> {
  const rows = list
    .filter((e) => e && ALLOWED.has(e.type))
    .slice(0, 50)
    .map((e) => ({
      sessionId: String(e.sessionId || "").slice(0, 64),
      type: e.type,
      path: String(e.path || "").slice(0, 300),
      handle: String(e.handle || "").slice(0, 200),
      query: String(e.query || "").slice(0, 200).toLowerCase(),
      valueCents: Math.max(0, Math.round(Number(e.valueCents) || 0)),
      props: (e.props && typeof e.props === "object" ? e.props : {}) as Record<string, unknown>,
    }));
  if (!rows.length) return 0;
  const db = getDb();
  await db.insert(events).values(rows);
  return rows.length;
}

const sinceClause = (days: number) => sql`created_at > now() - (${days} || ' days')::interval`;

export async function getDashboard(days = 30) {
  const db = getDb();
  const q = <T extends Record<string, unknown>>(s: any) => db.execute<T>(s).then((r) => r.rows);

  const [counts, topProducts, topSearches, noResults, funnel, daily] = await Promise.all([
    q<{ type: string; n: number }>(sql`select type, count(*)::int n from ${events} where ${sinceClause(days)} group by type order by n desc`),
    q<{ handle: string; n: number }>(sql`select handle, count(*)::int n from ${events} where type='product_view' and handle<>'' and ${sinceClause(days)} group by handle order by n desc limit 15`),
    q<{ query: string; n: number }>(sql`select query, count(*)::int n from ${events} where type='search' and query<>'' and ${sinceClause(days)} group by query order by n desc limit 15`),
    q<{ query: string; n: number }>(sql`select query, count(*)::int n from ${events} where type='search_no_results' and query<>'' and ${sinceClause(days)} group by query order by n desc limit 15`),
    q<{ type: string; sessions: number }>(sql`select type, count(distinct session_id)::int sessions from ${events} where type in ('product_view','add_to_cart','checkout_start','purchase') and ${sinceClause(days)} group by type`),
    q<{ d: string; views: number; carts: number; orders: number }>(sql`
      select to_char(date_trunc('day', created_at),'YYYY-MM-DD') d,
        count(*) filter (where type='product_view')::int views,
        count(*) filter (where type='add_to_cart')::int carts,
        count(*) filter (where type='purchase')::int orders
      from ${events} where ${sinceClause(days)} group by 1 order by 1 desc limit 14`),
  ]);

  const funnelMap = Object.fromEntries(funnel.map((f) => [f.type, f.sessions]));
  return { days, counts, topProducts, topSearches, noResults, funnel: funnelMap, daily };
}

/** Bestsellers/trending op basis van add_to_cart + product_view (laatste N dagen). */
export async function getTrendingHandles(days = 14, limit = 8): Promise<string[]> {
  const db = getDb();
  const rows = await db.execute<{ handle: string }>(sql`
    select handle, sum(case when type='add_to_cart' then 3 when type='product_view' then 1 else 0 end) score
    from ${events}
    where handle<>'' and type in ('product_view','add_to_cart') and ${sinceClause(days)}
    group by handle order by score desc limit ${limit}
  `);
  return rows.rows.map((r) => r.handle);
}
