import { NextResponse } from "next/server";
import { findOrCreateCustomer, createSession, claimGuestData } from "@/lib/account";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * Preview-login zonder e-mailinfra. ALLEEN buiten productie én alleen als de env
 * DEMO_LOGIN_EMAIL gezet is (bv. demo@gents.nl). Logt direct in als dat account,
 * zodat de profielpagina te bekijken is. In productie bestaat dit endpoint niet
 * (404) — anders zou een achtergebleven env-var een wachtwoordloze login-backdoor
 * zijn (mogelijk zelfs op een account met rechten).
 */
export async function GET() {
  // Harde gate: nooit een wachtwoordloze login in productie, ongeacht de env.
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }
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
