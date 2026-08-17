import { NextResponse } from "next/server";
import { getSessionCustomer, updateProfile } from "@/lib/account";
import {
  getNewsletterPrefs,
  setEmailSubscription,
  setWhatsappSubscription,
} from "@/lib/newsletter";

export const dynamic = "force-dynamic";

/** Huidige nieuwsbrief-voorkeuren van de ingelogde klant. */
export async function GET() {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "niet ingelogd" }, { status: 401 });
  return NextResponse.json({ ok: true, prefs: await getNewsletterPrefs(customer.email, customer.phone) });
}

/**
 * Kanaal aan/uit zetten. Body: { email?: boolean, whatsapp?: boolean }.
 * De klant is ingelogd, dus dit is een expliciete opt-in op zijn eigen adres —
 * geen bevestigingsmail nodig (zie lib/newsletter). marketingOptIn op de
 * klantrij loopt mee met het e-mailkanaal; anders zeggen de twee plekken in de
 * back-office iets verschillends over dezelfde klant.
 */
export async function POST(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "niet ingelogd" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }

  if (typeof body.email === "boolean") {
    await setEmailSubscription(customer.email, body.email);
    await updateProfile(customer.id, { marketingOptIn: body.email });
  }

  if (typeof body.whatsapp === "boolean") {
    // Zonder telefoonnummer valt er niets in te schrijven — dat moet de klant
    // eerst bij zijn gegevens invullen, anders melden we hem op niets aan.
    const ok = await setWhatsappSubscription(customer.phone, body.whatsapp);
    if (!ok) return NextResponse.json({ ok: false, error: "geen-telefoonnummer" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, prefs: await getNewsletterPrefs(customer.email, customer.phone) });
}
