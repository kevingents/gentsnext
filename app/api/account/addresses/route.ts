import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSessionCustomer } from "@/lib/account";
import { getDb } from "@/db";
import { customerAddresses } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Adresboek-CRUD voor de ingelogde klant.
 *  { action:"add"|"update", ...velden, isDefault? }
 *  { action:"delete"|"default", id }
 * Alleen eigen adressen (customer_id-check).
 */
export async function POST(req: Request) {
  const customer = await getSessionCustomer().catch(() => null);
  if (!customer) return NextResponse.json({ ok: false, error: "Niet ingelogd." }, { status: 401 });

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const db = getDb();
  const action = String(b.action || "");
  const cid = customer.id;
  const clean = (v: unknown, max = 80) => String(v ?? "").trim().slice(0, max);
  const owns = async (id: string) =>
    id ? (await db.select({ id: customerAddresses.id }).from(customerAddresses).where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, cid))).limit(1)).length > 0 : false;
  const unsetDefaults = () => db.update(customerAddresses).set({ isDefault: false }).where(eq(customerAddresses.customerId, cid));

  try {
    if (action === "delete") {
      const id = clean(b.id, 40);
      if (!(await owns(id))) return NextResponse.json({ ok: false, error: "Adres niet gevonden." }, { status: 404 });
      await db.delete(customerAddresses).where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, cid)));
      return NextResponse.json({ ok: true });
    }
    if (action === "default") {
      const id = clean(b.id, 40);
      if (!(await owns(id))) return NextResponse.json({ ok: false, error: "Adres niet gevonden." }, { status: 404 });
      await unsetDefaults();
      await db.update(customerAddresses).set({ isDefault: true }).where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, cid)));
      return NextResponse.json({ ok: true });
    }

    const fields = {
      label: clean(b.label) || "Thuis",
      firstName: clean(b.firstName), lastName: clean(b.lastName),
      street: clean(b.street), houseNumber: clean(b.houseNumber, 20),
      postalCode: clean(b.postalCode, 12).toUpperCase(), city: clean(b.city),
      country: (clean(b.country, 2).toUpperCase() || "NL"),
    };
    if (!fields.street || !fields.postalCode || !fields.city) {
      return NextResponse.json({ ok: false, error: "Vul minimaal straat, postcode en plaats in." }, { status: 400 });
    }
    const makeDefault = Boolean(b.isDefault);

    if (action === "update") {
      const id = clean(b.id, 40);
      if (!(await owns(id))) return NextResponse.json({ ok: false, error: "Adres niet gevonden." }, { status: 404 });
      if (makeDefault) await unsetDefaults();
      await db.update(customerAddresses).set({ ...fields, ...(makeDefault ? { isDefault: true } : {}) }).where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, cid)));
      return NextResponse.json({ ok: true });
    }

    // add
    if (makeDefault) await unsetDefaults();
    await db.insert(customerAddresses).values({ customerId: cid, ...fields, isDefault: makeDefault });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
