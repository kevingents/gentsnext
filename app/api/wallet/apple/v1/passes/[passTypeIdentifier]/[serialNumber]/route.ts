import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { customers } from "@/db/schema";
import { loyaltyPassSummary } from "@/lib/loyalty-claim";
import { buildLoyaltyPass } from "@/lib/apple-wallet";
import { activeVouchersForCustomer } from "@/lib/vouchers";
import { walletConfigured, verifyPassAuth } from "@/lib/apple-wallet-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PassKit web service — de laatste versie van de pas. iOS haalt dit op na een
 * push of periodieke poll. Auth = `Authorization: ApplePass <token>`. Geeft de
 * verse ondertekende .pkpass met een Last-Modified (= nieuwste saldowijziging);
 * bij een ongewijzigde pas een 304.
 */

type Params = { params: Promise<{ serialNumber: string }> };

export async function GET(req: Request, { params }: Params) {
  const { serialNumber } = await params;
  const h = req.headers.get("authorization") || "";
  const m = /^ApplePass\s+(.+)$/i.exec(h.trim());
  if (!m || !verifyPassAuth(serialNumber, m[1])) return new Response(null, { status: 401 });
  if (!walletConfigured()) return new Response(null, { status: 503 });

  try {
    const db = getDb();
    const [cust] = await db
      .select({
        id: customers.id,
        email: customers.email,
        firstName: customers.firstName,
        lastName: customers.lastName,
        createdAt: customers.createdAt,
      })
      .from(customers)
      .where(eq(customers.id, serialNumber))
      .limit(1);
    if (!cust) return new Response(null, { status: 404 });

    /* Last-Modified = nieuwste wijziging in de PASINHOUD. Voor de punten telt niet
       alleen het moment van vesten mee, maar ook het aanmaken van een event: sinds
       "in behandeling" op de pas staat, verandert de pas óók bij een nieuwe aankoop
       die pas over drie weken vest. Alleen op vests_at kijken gaf daar een 304 met
       een verouderd getal. */
    const saldo = await loyaltyPassSummary(cust.id);
    /* Ook op tegoedbonnen: die staan nu op de pas, en een verbruikte of verlopen
       bon maakt geen loyalty-event. Zonder dit blijft een pas met "EUR 25 tegoed"
       een 304 krijgen nadat dat tegoed al uitgegeven is — de klant staat dan in
       de winkel met een bedrag dat er niet meer is. Verlopen is tijd-gebaseerd,
       dus zelfde truc als vesting: alleen momenten die al gepasseerd zijn. */
    const vc = await db.execute<{ updated: string | null }>(sql`
      select max(t) updated from (
        select greatest(created_at, coalesce(redeemed_at, created_at),
                        case when expires_at is not null and expires_at <= now() then expires_at else created_at end) t
        from vouchers
        where customer_id = ${serialNumber}::uuid or lower(email) = lower(${cust.email})
      ) x where t <= now()`);

    const stamps = [saldo.lastChangedAt, vc.rows[0]?.updated]
      .map((v) => (v ? new Date(v as unknown as string).getTime() : 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    const lastModMs = stamps.length ? Math.max(...stamps) : new Date(cust.createdAt).getTime();

    const ims = req.headers.get("if-modified-since");
    if (ims) {
      const imsMs = new Date(ims).getTime();
      // Seconde-precisie: HTTP-datums hebben geen ms.
      if (Number.isFinite(imsMs) && Math.floor(lastModMs / 1000) <= Math.floor(imsMs / 1000)) {
        return new Response(null, { status: 304 });
      }
    }

    const tegoeden = await activeVouchersForCustomer({ customerId: cust.id, email: cust.email });
    const name = `${cust.firstName ?? ""} ${cust.lastName ?? ""}`.trim() || cust.email;
    const buf = buildLoyaltyPass({
      customerId: cust.id,
      name,
      email: cust.email,
      points: saldo.redeemable,
      pending: saldo.pending,
      pendingVestsAt: saldo.nextVestsAt,
      memberSince: cust.createdAt,
      vouchers: tegoeden.map((v) => ({ code: v.code, label: v.label, valueCents: v.valueCents, verlooptOp: v.verlooptOp })),
    });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.apple.pkpass",
        "Last-Modified": new Date(lastModMs).toUTCString(),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[wallet/v1/pass]", (e as Error).message);
    return new Response(null, { status: 500 });
  }
}
