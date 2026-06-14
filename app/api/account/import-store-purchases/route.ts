import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { customers } from "@/db/schema";
import { getSessionCustomer } from "@/lib/account";
import { importStorePurchases } from "@/lib/srs-store-import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Admin: importeert de winkelaankopen van één klant uit SRS (omnichannel). */
export async function POST(req: Request) {
  const admin = await getSessionCustomer();
  if (!admin?.isAdmin) return NextResponse.json({ ok: false, error: "geen toegang" }, { status: 403 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }
  const customerId = String(body.customerId || "").trim();
  if (!customerId) return NextResponse.json({ ok: false, error: "customerId ontbreekt" }, { status: 400 });

  const db = getDb();
  const [c] = await db
    .select({ id: customers.id, email: customers.email, srsCustomerId: customers.srsCustomerId })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!c) return NextResponse.json({ ok: false, error: "klant niet gevonden" }, { status: 404 });

  const result = await importStorePurchases(c);
  return NextResponse.json(result);
}
