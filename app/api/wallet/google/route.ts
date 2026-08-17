import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { redeemableBalance, pendingBalance } from "@/lib/loyalty-claim";
import { googleWalletConfigured, googleWalletSaveUrl } from "@/lib/google-wallet";
import { activeVouchersForCustomer } from "@/lib/vouchers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/wallet/google — stuurt de ingelogde klant door naar Google om de
 * GENTS-spaarpas toe te voegen (Android-tegenhanger van /api/wallet/apple).
 *
 * Anders dan bij Apple leveren we geen bestand maar een redirect: de kaart zit
 * als ondertekende JWT in de save-link en Google maakt 'm aan. Env-gated: zonder
 * service-account een nette 503 (de UI toont de knop dan sowieso niet).
 */
export async function GET() {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ error: "Log in om je spaarpas toe te voegen." }, { status: 401 });
  if (!googleWalletConfigured()) {
    return NextResponse.json({ error: "Google Wallet is nog niet geconfigureerd." }, { status: 503 });
  }
  try {
    const [points, pending, tegoeden] = await Promise.all([
      redeemableBalance(customer.id).then((p) => Math.max(0, p)),
      pendingBalance(customer.id).then((p) => Math.max(0, p)),
      activeVouchersForCustomer({ customerId: customer.id, email: customer.email }),
    ]);
    const name = `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || customer.email;
    const url = googleWalletSaveUrl({
      customerId: customer.id,
      name,
      email: customer.email,
      points,
      pending,
      vouchers: tegoeden.map((v) => ({ code: v.code, label: v.label, valueCents: v.valueCents })),
    });
    // 302 en niet een JSON-url: zo werkt de knop als gewone link, ook zonder JS.
    return NextResponse.redirect(url, { status: 302 });
  } catch (e) {
    console.error("[wallet/google]", e);
    return NextResponse.json({ error: "Kon de spaarpas niet maken." }, { status: 500 });
  }
}
