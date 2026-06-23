import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Publieke promo-config voor de client (staffelkorting) — voor de cart/afrekenen-weergave. */
export async function GET() {
  const s = await getSettings();
  return NextResponse.json({ tieredDiscount: s.tieredDiscount });
}
