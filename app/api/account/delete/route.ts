import { NextResponse } from "next/server";
import { getSessionCustomer, deleteAccount, logout } from "@/lib/account";

export const dynamic = "force-dynamic";

/**
 * AVG-verwijdering: anonimiseert het account van de ingelogde klant en logt uit.
 * Vereist een expliciete bevestiging in de body ({ confirm: "VERWIJDER" }).
 */
export async function POST(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "niet ingelogd" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* lege body → confirm ontbreekt */
  }
  if (body.confirm !== "VERWIJDER") {
    return NextResponse.json({ ok: false, error: "bevestiging ontbreekt" }, { status: 400 });
  }

  await deleteAccount(customer.id, customer.email);
  await logout(); // wist de sessie-cookie
  return NextResponse.json({ ok: true });
}
