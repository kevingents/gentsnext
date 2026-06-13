import { NextResponse } from "next/server";
import { findOrCreateCustomer, createSession, claimGuestData } from "@/lib/account";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * Preview-login zonder e-mailinfra. ALLEEN actief als de env DEMO_LOGIN_EMAIL
 * gezet is (bv. demo@gents.nl). Logt direct in als dat account, zodat de
 * profielpagina te bekijken is. Verwijder de env-var om dit uit te zetten.
 */
export async function GET() {
  const email = process.env.DEMO_LOGIN_EMAIL;
  const base = getSiteUrl();
  if (!email) {
    return NextResponse.redirect(`${base}/account/login`);
  }
  const customer = await findOrCreateCustomer(email);
  await createSession(customer.id);
  await claimGuestData(customer.id, customer.email);
  return NextResponse.redirect(`${base}/account`);
}
