import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Publieke promo-config voor de client (staffelkorting + verzend-drempels) — voor de
 *  cart/afrekenen-weergave, zodat de getoonde verzendkosten meelopen met de instelbare
 *  settings i.p.v. hardcoded te zijn (de server blijft autoritatief bij het afrekenen). */
export async function GET() {
  const s = await getSettings();
  return NextResponse.json({
    tieredDiscount: s.tieredDiscount,
    freeShippingCents: s.freeShippingCents,
    shippingCents: s.shippingCents,
  });
}
