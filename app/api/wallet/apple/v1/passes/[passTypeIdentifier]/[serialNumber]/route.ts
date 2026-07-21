import { eq, max } from "drizzle-orm";
import { getDb } from "@/db";
import { customers, loyaltyEvents } from "@/db/schema";
import { redeemableBalance } from "@/lib/loyalty-claim";
import { walletConfigured, buildLoyaltyPass, verifyPassAuth } from "@/lib/apple-wallet";

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

    // Last-Modified = nieuwste loyalty-event (val terug op account-aanmaak).
    const [ev] = await db
      .select({ updated: max(loyaltyEvents.createdAt) })
      .from(loyaltyEvents)
      .where(eq(loyaltyEvents.customerId, serialNumber));
    const lastModMs = ev?.updated ? new Date(ev.updated as unknown as string).getTime() : new Date(cust.createdAt).getTime();

    const ims = req.headers.get("if-modified-since");
    if (ims) {
      const imsMs = new Date(ims).getTime();
      // Seconde-precisie: HTTP-datums hebben geen ms.
      if (Number.isFinite(imsMs) && Math.floor(lastModMs / 1000) <= Math.floor(imsMs / 1000)) {
        return new Response(null, { status: 304 });
      }
    }

    const points = Math.max(0, await redeemableBalance(cust.id));
    const name = `${cust.firstName ?? ""} ${cust.lastName ?? ""}`.trim() || cust.email;
    const buf = buildLoyaltyPass({
      customerId: cust.id,
      name,
      email: cust.email,
      points,
      memberSince: cust.createdAt,
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
