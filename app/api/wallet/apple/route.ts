import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { loyaltyPassSummary } from "@/lib/loyalty-claim";
import { walletConfigured, buildLoyaltyPass } from "@/lib/apple-wallet";
import { activeVouchersForCustomer } from "@/lib/vouchers";

// node-forge (ondertekening) heeft de Node-runtime nodig, niet edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/wallet/apple — levert de GENTS-spaarpas (.pkpass) voor de ingelogde klant.
 * iPhone/Safari (of Mac) opent 'm direct in Apple Wallet. Env-gated: zonder
 * pass-certificaat een nette 503 (de UI toont de knop dan sowieso niet).
 */
export async function GET() {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ error: "Log in om je spaarpas toe te voegen." }, { status: 401 });
  if (!walletConfigured()) {
    return NextResponse.json({ error: "Apple Wallet is nog niet geconfigureerd." }, { status: 503 });
  }
  try {
    const [saldo, tegoeden] = await Promise.all([
      loyaltyPassSummary(customer.id),
      activeVouchersForCustomer({ customerId: customer.id, email: customer.email }),
    ]);
    const name = `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || customer.email;
    const buf = buildLoyaltyPass({
      customerId: customer.id,
      name,
      email: customer.email,
      points: saldo.redeemable,
      pending: saldo.pending,
      pendingVestsAt: saldo.nextVestsAt,
      memberSince: customer.createdAt,
      vouchers: tegoeden.map((v) => ({ code: v.code, label: v.label, valueCents: v.valueCents, verlooptOp: v.verlooptOp })),
    });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition": 'attachment; filename="gents-spaarpas.pkpass"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[wallet/apple]", e);
    return NextResponse.json({ error: "Kon de spaarpas niet maken." }, { status: 500 });
  }
}
