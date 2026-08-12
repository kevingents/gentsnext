import { NextResponse } from "next/server";
import { getStores, storesByDistance } from "@/lib/stores";

export const dynamic = "force-dynamic";

/**
 * Winkels voor de afhaal-keuze in de checkout en voor de winkelkiezer.
 * name = winkelnaam ("GENTS Groningen"), zoals de voorraadrijen 'm dragen.
 *
 * Gesorteerd op afstand tot de bezoeker wanneer we die kennen: Vercel zet de
 * geschatte locatie van het IP-adres in request-headers, dus daar is geen
 * toestemmingsvraag of GPS voor nodig — en we bewaren 'm ook nergens. Kennen we
 * 'm niet (lokaal draaien, VPN), dan blijft de vaste volgorde staan; een
 * willekeurige volgorde zou erger zijn dan alfabetisch.
 */
export async function GET(req: Request) {
  const lat = Number(req.headers.get("x-vercel-ip-latitude"));
  const lng = Number(req.headers.get("x-vercel-ip-longitude"));
  const vanaf = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { lat, lng } : null;

  const stores = storesByDistance(getStores(), vanaf).map((s) => ({
    name: s.title,
    city: s.city,
    pageHandle: s.pageHandle,
    distanceKm: s.distanceKm ?? null,
  }));
  return NextResponse.json({ stores, sortedByDistance: Boolean(vanaf) });
}
