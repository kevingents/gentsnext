import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { getRecommendedFromHistory, getNewArrivalsInSize } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/**
 * Persoonlijke "Voor jou"-strip op de homepage. Sessie-gated zodat de homepage
 * zelf statisch/cachebaar blijft (de strip laadt client-side na). Geeft de beste
 * beschikbare bron: smaak uit historie → anders new arrivals in de maat.
 */
export async function GET() {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ ok: true, items: [] });

  const [recommended, newInSize] = await Promise.all([
    getRecommendedFromHistory(customer.id, customer.sizeProfile, 8),
    getNewArrivalsInSize(customer.sizeProfile, 8),
  ]);

  if (recommended.length >= 4) {
    return NextResponse.json({ ok: true, eyebrow: "Voor jou", title: "Geselecteerd op jouw stijl", items: recommended });
  }
  if (newInSize.length >= 4) {
    return NextResponse.json({ ok: true, eyebrow: "Nieuw in jouw maat", title: "Vers binnen, in jouw maat", items: newInSize });
  }
  return NextResponse.json({ ok: true, items: [] });
}
