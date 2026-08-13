import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { resolveZones } from "@/lib/shipping-zones";

export const dynamic = "force-dynamic";

/**
 * De bezorglanden zoals ze nu ingesteld staan, voor de afrekenpagina.
 *
 * Waarom een endpoint en niet gewoon de tabel importeren: welke landen aanstaan
 * en wat ze kosten is een knop in de tool, en de checkout is een client-
 * component die de instellingen niet kan lezen. Het postcode-patroon en de
 * landnaam blijven in de code — die staan al in dezelfde tabel aan beide kanten.
 */
export async function GET() {
  const { shippingZones } = await getSettings();
  const zones = resolveZones(shippingZones).map((z) => ({
    code: z.code,
    rateCents: z.rateCents,
    freeFromCents: z.freeFromCents,
    extraDays: z.extraDays,
    enabled: z.enabled,
  }));
  return NextResponse.json({ zones });
}
