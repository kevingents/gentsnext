import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { adminOrToken } from "@/lib/studio-token";
import { getDb } from "@/db";
import { vouchers } from "@/db/schema";
import { createWelcomeVoucher } from "@/lib/vouchers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/vouchers?status&page — gepagineerde lijst kortingscodes
 * (vouchers) voor het portal-"Nieuwe site"-CMS. Recent eerst. Bedragen in centen.
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const status = (sp.get("status") || "").trim();
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(sp.get("pageSize")) || 30));

  try {
    const db = getDb();
    const conds = [sql`1=1`];
    if (status) conds.push(sql`status = ${status}`);
    const where = sql.join(conds, sql` and `);

    const [{ n }] = (
      await db.execute<{ n: string }>(sql`select count(*) n from vouchers where ${where}`)
    ).rows;

    const rows = await db.execute<{
      code: string;
      customer_id: string | null;
      description: string;
      kind: string;
      value_cents: number;
      percent_off: number;
      min_spend_cents: number;
      status: string;
      email: string;
      single_use: boolean;
      expires_at: string | null;
      redeemed_at: string | null;
      created_at: string;
    }>(sql`
      select code, customer_id, description, kind, value_cents, percent_off, min_spend_cents,
             status, email, single_use, expires_at, redeemed_at, created_at
      from vouchers where ${where}
      order by created_at desc limit ${pageSize} offset ${(page - 1) * pageSize}`);

    return NextResponse.json({
      ok: true,
      total: Number(n) || 0,
      page,
      pageSize,
      rows: rows.rows.map((x) => ({
        code: x.code,
        customerId: x.customer_id,
        description: x.description || "",
        kind: x.kind,
        valueCents: Number(x.value_cents) || 0,
        percentOff: Number(x.percent_off) || 0,
        minSpendCents: Number(x.min_spend_cents) || 0,
        status: x.status,
        email: x.email || "",
        singleUse: Boolean(x.single_use),
        expiresAt: x.expires_at,
        redeemedAt: x.redeemed_at,
        createdAt: x.created_at,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/studio/site/vouchers — maakt een kortingscode aan. Body:
 *   { kind:"percent"|"amount", percentOff?, valueCents?, email?, minSpendCents?, days?, singleUse?, code? }
 * Percent-codes met een e-mailadres lopen via createWelcomeVoucher (hergebruik
 * bestaande logica). Alle andere gevallen: directe Drizzle-insert met een (zelf
 * gegenereerde) korte, unieke code. Bedragen in centen. Auth: admin OF token.
 */
export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }

  let body: {
    kind?: unknown;
    percentOff?: unknown;
    valueCents?: unknown;
    email?: unknown;
    minSpendCents?: unknown;
    days?: unknown;
    singleUse?: unknown;
    code?: unknown;
    description?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const kind = String(body?.kind || "amount").trim() === "percent" ? "percent" : "amount";
  const percentOff = Math.max(0, Math.min(100, Math.round(Number(body?.percentOff) || 0)));
  const valueCents = Math.max(0, Math.round(Number(body?.valueCents) || 0));
  const minSpendCents = Math.max(0, Math.round(Number(body?.minSpendCents) || 0));
  const days = Math.max(0, Math.round(Number(body?.days) || 0));
  const email = String(body?.email || "").trim().toLowerCase();
  const singleUse = body?.singleUse === undefined ? true : Boolean(body?.singleUse);
  const description = String(body?.description || "").trim();
  const wantCode = String(body?.code || "").trim().toUpperCase();

  if (kind === "percent" && percentOff <= 0) {
    return NextResponse.json({ ok: false, error: "Vul een geldig percentage in (1–100)." }, { status: 400 });
  }
  if (kind === "amount" && valueCents <= 0) {
    return NextResponse.json({ ok: false, error: "Vul een geldig bedrag in." }, { status: 400 });
  }

  try {
    // Percent-code met e-mailadres: hergebruik de bestaande welkomstvoucher-logica
    // (idempotent per adres). Geen aparte code-generatie nodig.
    if (kind === "percent" && email) {
      const code = await createWelcomeVoucher(email, percentOff, days > 0 ? days : 30);
      return NextResponse.json({ ok: true, code });
    }

    const db = getDb();
    const code = wantCode || (await uniqueCode(db));
    await db.insert(vouchers).values({
      code,
      description,
      kind,
      valueCents: kind === "amount" ? valueCents : 0,
      percentOff: kind === "percent" ? percentOff : 0,
      minSpendCents,
      status: "active",
      email,
      singleUse,
      expiresAt: days > 0 ? new Date(Date.now() + days * 86400000) : null,
    });
    return NextResponse.json({ ok: true, code });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/** Genereert een korte, uppercase-alfanumerieke code die nog niet bestaat. */
async function uniqueCode(db: ReturnType<typeof getDb>): Promise<string> {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // zonder I/O/0/1 (leesbaarheid)
  for (let attempt = 0; attempt < 8; attempt++) {
    let code = "";
    for (let i = 0; i < 8; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    const [{ n }] = (
      await db.execute<{ n: string }>(sql`select count(*) n from vouchers where code = ${code}`)
    ).rows;
    if ((Number(n) || 0) === 0) return code;
  }
  // Uiterst onwaarschijnlijk: val terug op een tijd-suffix.
  return "GENTS" + Date.now().toString(36).toUpperCase();
}
