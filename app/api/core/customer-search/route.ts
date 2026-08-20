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
/** Klant-id (met of zonder streepjes) of de pas-code "GENTS 1A2B3C4D" → id-lookup. */
function klantReferentie(q: string): { uuid?: string; prefix8?: string } | null {
  const s = q.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return { uuid: s.toLowerCase() };
  const kaal = s.replace(/[\s-]/g, "");
  if (/^[0-9a-f]{32}$/i.test(kaal)) {
    const h = kaal.toLowerCase();
    return { uuid: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` };
  }
  // Alleen de eerste 8 hex-tekens: die staan in een uuid vóór het eerste streepje.
  const m = /^gents[\s-]*([0-9a-f]{8})$/i.exec(s);
  return m ? { prefix8: m[1].toLowerCase() } : null;
}

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
  /* Gescande spaarpas → exact op klant-id. De QR bevat het kale id en de leesbare
     code eronder is "GENTS 1A2B3C4D"; allebei matchten hiervoor nergens op, want
     deze zoek doet ILIKE op e-mail/naam. Een scan gaf dus stil "geen klant". */
  const ref = klantReferentie(q);
  const where = ref?.uuid
    ? sql`c.id = ${ref.uuid}::uuid`
    : ref?.prefix8
      ? sql`c.id::text like ${ref.prefix8 + "%"}`
      : sql`c.email ilike ${term} or (c.first_name || ' ' || c.last_name) ilike ${term}`;
  /* Tegoed en punten meteen mee in de trefferlijst: de kassier moet aan de
     zoekresultaten al kunnen zien dat een klant iets heeft openstaan, zonder
     eerst de klantkaart te openen (Kevin 20 aug). Twee laterals per rij op een
     lijst van max 10 — verwaarloosbaar naast de SOAP-call die parallel loopt.
     Punten: besteedbaar saldo uit HET grootboek (loyalty_events, gevest) — de
     loyalty_accounts-kopie is een oude kassa-pot met verouderde saldi. */
  const rows = await db.execute<{
    id: string; first_name: string; last_name: string; email: string; phone: string; city: string | null;
    tegoed_aantal: number; tegoed_cents: number; punten: number;
  }>(sql`
    select c.id, c.first_name, c.last_name, c.email, c.phone,
           (select a.city from customer_addresses a where a.customer_id = c.id order by a.is_default desc limit 1) city,
           coalesce(t.aantal, 0) tegoed_aantal,
           coalesce(t.cents, 0) tegoed_cents,
           coalesce(le.punten, 0) punten
    from customers c
    left join lateral (
      select count(*)::int aantal, coalesce(sum(v.value_cents), 0)::int cents
      from vouchers v
      where v.status = 'active'
        and (v.expires_at is null or v.expires_at > now())
        and (v.customer_id = c.id or (v.email <> '' and lower(v.email) = lower(c.email)))
    ) t on true
    left join lateral (
      select coalesce(sum(le.points), 0)::int punten
      from loyalty_events le
      where le.customer_id = c.id
        and (le.vests_at is null or le.vests_at <= now())
    ) le on true
    where ${where}
    order by c.last_login_at desc nulls last
    limit 10`);
  /* Korte pas-code die op twee klanten matcht: niets teruggeven. Aan de kassa de
     verkeerde klant koppelen betekent punten en historie op het verkeerde account. */
  if (ref?.prefix8 && rows.rows.length > 1) {
    console.warn(`[customer-search] pas-code ${ref.prefix8} matcht ${rows.rows.length} klanten — niets teruggegeven`);
    return NextResponse.json({ ok: true, customers: [] });
  }

  const list = rows.rows.map((r) => ({
    customerId: r.id,
    name: `${r.first_name} ${r.last_name}`.trim() || r.email,
    email: r.email,
    phone: r.phone || "",
    city: r.city || "",
    tegoed: { aantal: Number(r.tegoed_aantal) || 0, valueCents: Number(r.tegoed_cents) || 0 },
    punten: Number(r.punten) || 0,
  }));
  // Audit-spoor: vingerafdruk + querylengte + aantal treffers — NOOIT de ruwe
  // zoekterm of de PII-resultaten. Bulk-enumeratie valt zo op in de logs.
  console.info(`[customer-search] fp=${fp} qlen=${q.length} hits=${list.length}`);
  return NextResponse.json({ ok: true, customers: list });
}
