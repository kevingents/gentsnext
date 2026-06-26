import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getDb } from "@/db";
import { customers, customerAddresses } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/customer-create — maak/vind een klant in het gents.nl-bestand
 * (de omnichannel-bron, waar ook de spaarpunten leven). Idempotent op e-mail:
 * bestaat 'ie al, dan vullen we alleen lege velden aan. Auth: STORE_CORE_TOKEN.
 *
 * Body: { email, firstName, lastName, phone?, street?, houseNumber?, postalCode?, city? }
 *   → { ok, customerId, name, email, phone, created }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: Record<string, string>;
  try { b = (await req.json()) as Record<string, string>; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }

  const email = String(b?.email || "").trim().toLowerCase();
  if (!/.+@.+\..+/.test(email)) return NextResponse.json({ ok: false, error: "Geldig e-mailadres vereist." }, { status: 400 });
  const firstName = String(b?.firstName || "").trim();
  const lastName = String(b?.lastName || "").trim();
  const phone = String(b?.phone || "").trim();
  const street = String(b?.street || "").trim();
  const houseNumber = String(b?.houseNumber || "").trim();
  const postalCode = String(b?.postalCode || "").trim().toUpperCase().replace(/\s+/g, "");
  const city = String(b?.city || "").trim();

  const db = getDb();
  let [c] = await db.select().from(customers).where(eq(customers.email, email)).limit(1);
  let created = false;
  if (!c) {
    [c] = await db.insert(customers).values({ email, firstName, lastName, phone }).returning();
    created = true;
  } else {
    // Alleen lege velden aanvullen (bestaande gegevens niet overschrijven).
    const patch: Partial<typeof customers.$inferInsert> = {};
    if (!c.firstName && firstName) patch.firstName = firstName;
    if (!c.lastName && lastName) patch.lastName = lastName;
    if (!c.phone && phone) patch.phone = phone;
    if (Object.keys(patch).length) {
      patch.updatedAt = new Date();
      await db.update(customers).set(patch).where(eq(customers.id, c.id));
      c = { ...c, ...patch } as typeof c;
    }
  }

  // Adres toevoegen als opgegeven én er nog geen adres is.
  if (street && postalCode) {
    const existing = await db.select({ id: customerAddresses.id }).from(customerAddresses).where(eq(customerAddresses.customerId, c.id)).limit(1);
    if (!existing.length) {
      await db.insert(customerAddresses).values({ customerId: c.id, firstName: firstName || c.firstName, lastName: lastName || c.lastName, street, houseNumber, postalCode, city, country: "NL", isDefault: true });
    }
  }

  const name = `${c.firstName} ${c.lastName}`.trim() || c.email;
  return NextResponse.json({ ok: true, customerId: c.id, name, email: c.email, phone: c.phone || phone, created });
}
