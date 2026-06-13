import { NextResponse } from "next/server";
import { getSessionCustomer, updateProfile, updateSizeProfile, type SizeProfile } from "@/lib/account";

export const dynamic = "force-dynamic";

/** Werkt persoonsgegevens en/of maatprofiel bij voor de ingelogde klant. */
export async function POST(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "niet ingelogd" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }

  if (body.section === "size") {
    await updateSizeProfile(customer.id, (body.sizeProfile || {}) as SizeProfile);
    return NextResponse.json({ ok: true });
  }

  await updateProfile(customer.id, {
    firstName: typeof body.firstName === "string" ? body.firstName : undefined,
    lastName: typeof body.lastName === "string" ? body.lastName : undefined,
    phone: typeof body.phone === "string" ? body.phone : undefined,
    marketingOptIn: typeof body.marketingOptIn === "boolean" ? body.marketingOptIn : undefined,
  });
  return NextResponse.json({ ok: true });
}
