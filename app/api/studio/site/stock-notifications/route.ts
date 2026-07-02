import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { adminOrToken } from "@/lib/studio-token";
import { getDb } from "@/db";
import { getSettings, updateSettings, type Settings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Portal-"Nieuwe site" → Terug op voorraad. Toont de aanmeldingen + statistieken en
 * beheert de flow-config (aan/uit, kanalen, wachttijd voor het alternatief).
 * GET  → { ok, config, stats, recent }
 * POST → body { config } → sanitized + opgeslagen. Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */

function sanitizeConfig(input: unknown): Settings["stockNotifyConfig"] {
  const b = (input || {}) as Record<string, unknown>;
  return {
    enabled: Boolean(b.enabled),
    emailEnabled: Boolean(b.emailEnabled),
    whatsappEnabled: Boolean(b.whatsappEnabled),
    alternativeEnabled: Boolean(b.alternativeEnabled),
    alternativeAfterDays: Math.max(1, Math.min(90, Math.round(Number(b.alternativeAfterDays) || 14))),
  };
}

type Row = {
  product_handle: string; product_title: string; size: string; color: string;
  channel: string; status: string; email: string; phone: string;
  created_at: string; notified_at: string | null;
};

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    const db = getDb();
    const [settings, statsRows, recent] = await Promise.all([
      getSettings(),
      db.execute<{ status: string; n: number }>(sql`select status, count(*)::int n from stock_notifications group by status`),
      db.execute<Row>(sql`
        select product_handle, product_title, size, color, channel, status, email, phone,
               to_char(created_at,'YYYY-MM-DD') created_at,
               to_char(notified_at,'YYYY-MM-DD') notified_at
        from stock_notifications order by created_at desc limit 100`),
    ]);
    const stats: Record<string, number> = { pending: 0, notified: 0, alternative_sent: 0, cancelled: 0, total: 0 };
    for (const r of statsRows.rows) {
      stats[r.status] = (stats[r.status] || 0) + r.n;
      stats.total += r.n;
    }
    return NextResponse.json({ ok: true, config: settings.stockNotifyConfig, stats, recent: recent.rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { config?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  try {
    const config = sanitizeConfig(body.config);
    await updateSettings({ stockNotifyConfig: config });
    return NextResponse.json({ ok: true, config });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
