import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { rateLimit, fingerprint } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/customer-search — zoek klanten in het gents.nl-bestand
 * (e-mail/naam) voor de kassa. Auth: STORE_CORE_TOKEN.
 *
 * Body: { q } → { ok, customers: [{ customerId, name, email, phone, city }] }
 *
 * Dit endpoint geeft klant-PII (naam/e-mail/telefoon) terug. Het is token-gated,
 * maar als de gedeelde STORE_CORE_TOKEN ooit zou lekken kan iemand het bestand
 * enumereren. Daarom: (1) een backstop rate-limit en (2) een audit-spoor (zonder
 * ruwe PII) zodat ongebruikelijke bulk-bevragingen zichtbaar zijn.
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  // Backstop rate-limit per token+IP-vingerafdruk (frictie tegen enumeratie).
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const fp = fingerprint(`${req.headers.get("authorization") || ""}|${ip}`);
  const rl = rateLimit(`custsearch:${fp}`, 120, 60_000);
  if (!rl.ok) {
    console.warn(`[customer-search] rate-limit overschreden fp=${fp} count=${rl.count}/min`);
    return NextResponse.json({ ok: false, error: "Te veel zoekopdrachten — even wachten." }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  }

  let b: { q?: string };
  try { b = (await req.json()) as { q?: string }; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const q = String(b?.q || "").trim();
  if (q.length < 2) return NextResponse.json({ ok: true, customers: [] });

  const term = `%${q.replace(/[%_]/g, "")}%`;
  const db = getDb();
  const rows = await db.execute<{ id: string; first_name: string; last_name: string; email: string; phone: string; city: string | null }>(sql`
    select c.id, c.first_name, c.last_name, c.email, c.phone,
           (select a.city from customer_addresses a where a.customer_id = c.id order by a.is_default desc limit 1) city
    from customers c
    where c.email ilike ${term} or (c.first_name || ' ' || c.last_name) ilike ${term}
    order by c.last_login_at desc nulls last
    limit 10`);

  const list = rows.rows.map((r) => ({
    customerId: r.id,
    name: `${r.first_name} ${r.last_name}`.trim() || r.email,
    email: r.email,
    phone: r.phone || "",
    city: r.city || "",
  }));
  // Audit-spoor: vingerafdruk + querylengte + aantal treffers — NOOIT de ruwe
  // zoekterm of de PII-resultaten. Bulk-enumeratie valt zo op in de logs.
  console.info(`[customer-search] fp=${fp} qlen=${q.length} hits=${list.length}`);
  return NextResponse.json({ ok: true, customers: list });
}
