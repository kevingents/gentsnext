import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { events } from "@/db/schema";

/**
 * Eerlijke social-proof op de PDP: échte kijk-statistieken uit onze eigen
 * analytics (events.product_view), GEEN verzonnen "x mensen kijken nu"-cijfers.
 * Drempel-gated in de UI zodat een zwak signaal (1-2 views) niets toont.
 */
export type ViewStats = { viewers24h: number; views7d: number };

export async function getProductViewStats(handle: string): Promise<ViewStats> {
  if (!handle) return { viewers24h: 0, views7d: 0 };
  try {
    const db = getDb();
    const rows = await db.execute<{ viewers24h: number; views7d: number }>(sql`
      select
        count(distinct session_id) filter (where created_at > now() - interval '24 hours')::int as viewers24h,
        count(*) filter (where created_at > now() - interval '7 days')::int as views7d
      from ${events}
      where type = 'product_view' and handle = ${handle}
        and created_at > now() - interval '7 days'
    `);
    const r = rows.rows[0];
    return { viewers24h: Number(r?.viewers24h) || 0, views7d: Number(r?.views7d) || 0 };
  } catch {
    return { viewers24h: 0, views7d: 0 };
  }
}
