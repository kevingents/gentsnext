import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { maatadviesLog } from "@/db/schema";
import { getSessionCustomer } from "@/lib/account";
import { rateLimit, fingerprint } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Legt vast wélk maatadvies we hebben gegeven, zodat we later kunnen meten of
 * het klopte (Site → Maten → Advieskwaliteit).
 *
 * Publiek endpoint — het maatadvies werkt ook zonder in te loggen. Daarom:
 *  - AVG: `klantId` alleen bij een INGELOGDE bezoeker. Die gaf bij Mijn maten
 *    toestemming voor precies dit doel. Een anonieme bezoeker levert een rij
 *    zonder énige identificatie: geen sessie-id, geen IP, geen fingerprint. Het
 *    IP gebruiken we alleen als rate-limit-sleutel (gehasht, niet opgeslagen).
 *  - Bereiken worden gecontroleerd, net als in de adviseur zelf: een log vol
 *    "lengte 3 cm" maakt de meting waardeloos.
 *
 * Antwoordt altijd 200/202 zonder inhoud. Een klant hoort nooit iets te merken
 * van een meting die misgaat — het advies stond al op zijn scherm.
 */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  // Ruim: één bezoeker klikt makkelijk tien keer op "Toon mijn maat" terwijl hij
  // met zijn gewicht speelt. Dit houdt alleen scripts tegen.
  const rl = rateLimit("maatadvies:" + fingerprint(ip), 40, 60_000);
  if (!rl.ok) return new NextResponse(null, { status: 202 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 202 });
  }

  const nummer = (v: unknown, min: number, max: number): number => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= min && n <= max ? n : 0;
  };
  const lengteCm = nummer(body.lengteCm, 140, 215);
  const gewichtKg = nummer(body.gewichtKg, 45, 180);
  const borstCm = nummer(body.borstCm, 60, 160);
  // Zonder bruikbare lengte/gewicht valt er niets te meten; stil laten vallen.
  if (!lengteCm || !gewichtKg) return new NextResponse(null, { status: 202 });

  const uitLijst = (v: unknown, toegestaan: string[], standaard: string): string => {
    const s = String(v ?? "").trim();
    return toegestaan.includes(s) ? s : standaard;
  };
  const maat = (v: unknown): string => String(v ?? "").trim().slice(0, 20);

  try {
    const klant = await getSessionCustomer().catch(() => null);
    await getDb().insert(maatadviesLog).values({
      klantId: klant?.id ?? null,
      lengteCm,
      gewichtKg,
      borstCm,
      pasvorm: uitLijst(body.pasvorm, ["slim", "regular", "comfort"], "regular"),
      gemeten: body.gemeten === true,
      adviesColbert: maat(body.adviesColbert),
      adviesBoord: maat(body.adviesBoord),
      adviesLengtemaat: maat(body.adviesLengtemaat),
      zekerheid: uitLijst(body.zekerheid, ["hoog", "gemiddeld", "laag"], "gemiddeld"),
      bron: uitLijst(body.bron, ["maatadvies", "pdp", "account"], "maatadvies"),
      tabelVersie: nummer(body.tabelVersie, 0, 100000),
    });
  } catch (e) {
    console.error("[maatadvies/log] wegschrijven mislukt:", e);
  }
  return new NextResponse(null, { status: 202 });
}
