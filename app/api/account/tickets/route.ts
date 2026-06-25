import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { fetchCustomerTickets, replyToCustomerTicket } from "@/lib/helpdesk";

export const dynamic = "force-dynamic";

/** Tickets van de ingelogde klant (e-mail komt uit de sessie, niet uit de request). */
export async function GET() {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "niet ingelogd" }, { status: 401 });
  const tickets = await fetchCustomerTickets(customer.email);
  return NextResponse.json({ ok: true, tickets });
}

/** Klant reageert op een eigen ticket. */
export async function POST(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "niet ingelogd" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!ref || !text) return NextResponse.json({ ok: false, error: "ref en text verplicht" }, { status: 400 });

  const ok = await replyToCustomerTicket(customer.email, ref, text);
  return NextResponse.json({ ok });
}
