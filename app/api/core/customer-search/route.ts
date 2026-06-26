import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/customer-search — zoek klanten in het gents.nl-bestand
 * (e-mail/naam) voor de kassa. Auth: STORE_CORE_TOKEN.
 *
 * Body: { q } → { ok, customers: [{ customerId, name, email, phone, city }] }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

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
  return NextResponse.json({ ok: true, customers: list });
}
