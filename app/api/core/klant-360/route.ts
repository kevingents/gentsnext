import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { coreAuth } from "@/lib/store-core-token";
import { getDb } from "@/db";
import { customers } from "@/db/schema";
import { getKlant360, ververProfiel } from "@/lib/customer-360";
import { rateLimit, fingerprint } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/klant-360 — het complete klantbeeld voor de portal en de kassa.
 *
 * Body: { customerId, ververs? } → { ok, klant, profiel, orders, kassabonnen, … }
 *
 * Eén endpoint voor beide schermen. Dat is de hele bedoeling: de portal en de
 * kassa toonden tot nu toe elk hun eigen halve beeld (de portal miste de
 * kassabonnen, de kassa miste de loyalty en de SRS-historie), waardoor een
 * verkoper en een medewerker letterlijk naar een andere klant keken.
 *
 * Geeft PII terug en is dus token-gated, met dezelfde backstop-rate-limit en
 * hetzelfde auditspoor als customer-search — als de gedeelde token ooit lekt
 * mag dit endpoint geen stille bulk-uitlezing van het klantbestand worden.
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const fp = fingerprint(`${req.headers.get("authorization") || ""}|${ip}`);
  const rl = rateLimit(`klant360:${fp}`, 120, 60_000);
  if (!rl.ok) {
    console.warn(`[klant-360] rate-limit overschreden fp=${fp} count=${rl.count}/min`);
    return NextResponse.json({ ok: false, error: "Te veel verzoeken." }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  }

  let b: { customerId?: string; ververs?: boolean };
  try {
    b = (await req.json()) as { customerId?: string; ververs?: boolean };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }

  const id = String(b?.customerId || "").trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return NextResponse.json({ ok: false, error: "Ongeldig klant-id." }, { status: 400 });

  const db = getDb();
  const [c] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!c) return NextResponse.json({ ok: false, error: "Klant niet gevonden." }, { status: 404 });

  // Op verzoek eerst herrekenen — voor de knop "profiel verversen" in de portal.
  // Standaard uit: het profiel wordt al bijgewerkt na elke aankoop en 's nachts,
  // en een herberekening per schermopening is zonde bij 46.000 klanten.
  if (b?.ververs) await ververProfiel(id);

  const data = await getKlant360(id, c.email);
  console.log(`[audit] klant-360 fp=${fp} klant=${id.slice(0, 8)}`);

  return NextResponse.json({
    ok: true,
    klant: {
      id: c.id, email: c.email, firstName: c.firstName, lastName: c.lastName,
      phone: c.phone, srsCustomerId: c.srsCustomerId, marketingOptIn: c.marketingOptIn,
      sizeProfile: c.sizeProfile, createdAt: c.createdAt, lastLoginAt: c.lastLoginAt,
    },
    profiel: data.profiel,
    identiteiten: data.identiteiten,
    orders: data.onlineOrders,
    kassabonnen: data.kassabonnen,
    winkelhistorie: data.storeBuys,
    retouren: data.returns,
    vouchers: data.activeVouchers,
    giftcards: data.giftcards,
    punten: { totaal: data.pointsBalance, beschikbaar: data.pointsAvailable, inBehandeling: data.pointsPending },
    loyalty: data.loyalty,
    vragen: data.vragen,
    afspraken: data.afspraken,
    reserveringen: data.reserveringen,
    reviews: data.reviews,
    nieuwsbrief: data.nieuwsbrief,
    adressen: data.addresses,
    tijdlijn: data.tijdlijn,
  });
}
