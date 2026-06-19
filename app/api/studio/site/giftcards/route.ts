import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { adminOrToken } from "@/lib/studio-token";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/giftcards?status&page — gepagineerde lijst cadeaubonnen
 * voor het portal-"Nieuwe site"-CMS. Recent eerst. Bedragen in centen.
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
      await db.execute<{ n: string }>(sql`select count(*) n from giftcards where ${where}`)
    ).rows;

    const rows = await db.execute<{
      code: string;
      initial_cents: number;
      balance_cents: number;
      status: string;
      recipient_name: string;
      recipient_email: string;
      sender_name: string;
      buyer_email: string;
      customer_id: string | null;
      mollie_payment_id: string | null;
      expires_at: string | null;
      issued_at: string | null;
      created_at: string;
    }>(sql`
      select code, initial_cents, balance_cents, status, recipient_name, recipient_email,
             sender_name, buyer_email, customer_id, mollie_payment_id,
             expires_at, issued_at, created_at
      from giftcards where ${where}
      order by created_at desc limit ${pageSize} offset ${(page - 1) * pageSize}`);

    return NextResponse.json({
      ok: true,
      total: Number(n) || 0,
      page,
      pageSize,
      rows: rows.rows.map((x) => ({
        code: x.code,
        initialCents: Number(x.initial_cents) || 0,
        balanceCents: Number(x.balance_cents) || 0,
        status: x.status,
        recipientName: x.recipient_name || "",
        recipientEmail: x.recipient_email || "",
        senderName: x.sender_name || "",
        buyerEmail: x.buyer_email || "",
        customerId: x.customer_id,
        molliePaymentId: x.mollie_payment_id,
        expiresAt: x.expires_at,
        issuedAt: x.issued_at,
        createdAt: x.created_at,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
