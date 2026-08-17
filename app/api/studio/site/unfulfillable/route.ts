import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { adminOrToken } from "@/lib/studio-token";
import { getDb } from "@/db";
import { listUnresolvedUnfulfillable, getFulfillmentMissesByStore } from "@/lib/unfulfillable";
import { getSettings, updateSettings, type Settings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Portal-"Nieuwe site" → Niet leverbaar.
 * GET  → open meldingen (make-whole), miss-rate per winkel, de flow-config en de
 *        opbrengst van de alternatieven (aangeboden vs. doorgeklikt).
 * POST → body { config } → gesaneerd opgeslagen.
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 *
 * De config staat bewust in de instellingen-store en niet in een Vercel-env:
 * of de klant bij een annulering bericht + alternatieven krijgt, moet zonder
 * redeploy om te zetten zijn.
 */

function sanitizeConfig(input: unknown): Settings["unfulfillableConfig"] {
  const b = (input || {}) as Record<string, unknown>;
  return {
    emailEnabled: Boolean(b.emailEnabled),
    alternativesEnabled: Boolean(b.alternativesEnabled),
    alternativesCount: Math.max(1, Math.min(6, Math.round(Number(b.alternativesCount) || 3))),
  };
}

/**
 * Levert een annulering nog iets op? `alt_offered` telt de verstuurde mails met
 * alternatieven, `alt_click` de doorkliks (uit de mail én van de bestelpagina).
 */
async function alternativesStats(days = 90) {
  const db = getDb();
  const rows = await db.execute<{ type: string; src: string; n: number }>(sql`
    select type, coalesce(props ->> 'src', '') src, count(*)::int n
    from events
    where type in ('alt_offered', 'alt_click') and created_at > now() - (${days} || ' days')::interval
    group by type, src
  `);
  let offered = 0;
  let clickedMail = 0;
  let clickedPage = 0;
  for (const r of rows.rows) {
    if (r.type === "alt_offered") offered += r.n;
    else if (r.src === "bestelpagina") clickedPage += r.n;
    else clickedMail += r.n;
  }
  return {
    days,
    offered,
    clickedMail,
    clickedPage,
    // Doorklikratio op de mail; de bestelpagina heeft geen eigen noemer
    // (die zou elke herlaadbeurt meetellen) en staat daarom apart.
    clickRatePct: offered > 0 ? Math.round((clickedMail / offered) * 1000) / 10 : null,
  };
}

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  try {
    const [items, reliability, settings, alternatives] = await Promise.all([
      listUnresolvedUnfulfillable(150),
      getFulfillmentMissesByStore(90),
      getSettings(),
      alternativesStats(90).catch(() => null),
    ]);
    return NextResponse.json({ ok: true, items, reliability, config: settings.unfulfillableConfig, alternatives });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  let body: { config?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  if (!body?.config) return NextResponse.json({ ok: false, error: "Geen config." }, { status: 400 });
  try {
    const config = sanitizeConfig(body.config);
    await updateSettings({ unfulfillableConfig: config });
    return NextResponse.json({ ok: true, config });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
