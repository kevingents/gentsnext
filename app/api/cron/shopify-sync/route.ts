import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { cronSecretOk } from "@/lib/cron-auth";
import { syncShopifyOrders, shopifyGeconfigureerd } from "@/lib/shopify-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Haalt de Shopify-bestellingen op die er sinds de vorige run bij kwamen.
 *
 * Zolang gents.nl op Shopify draait is dit de enige aanvoer van verse orders.
 * Zonder deze cron loopt het klantprofiel stil: bij het bouwen bleek de laatste
 * order in Neon uit juni te komen, terwijl juli en augustus samen 1.412 orders
 * en 948 nieuwe klanten telden die hier volledig ontbraken. Een klant die
 * vorige week kocht stond daardoor als "slapend" in de segmentatie en zou een
 * terugwin-mail krijgen.
 *
 * Elk uur, met 48 uur overlap. Die overlap is er omdat een order in Shopify
 * later van status verandert (open → betaald) zonder dat `created_at`
 * meebeweegt; zonder marge zou je die statuswijziging voorgoed missen.
 */
export async function GET(req: Request) {
  if (!cronSecretOk(req)) {
    const customer = await getSessionCustomer().catch(() => null);
    if (!customer?.isAdmin) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!shopifyGeconfigureerd()) {
    return NextResponse.json({ ok: false, error: "Shopify-sleutels ontbreken" }, { status: 412 });
  }

  const url = new URL(req.url);
  const uren = Math.min(24 * 30, Math.max(2, Number(url.searchParams.get("uren")) || 48));

  try {
    const r = await syncShopifyOrders({ sindsUren: uren, maxOrders: 1500 });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error("[cron/shopify-sync]", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
