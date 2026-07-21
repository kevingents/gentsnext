import { eq, inArray, max } from "drizzle-orm";
import { getDb } from "@/db";
import { walletAppleRegistrations, loyaltyEvents } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PassKit web service — welke passen (van dit device) zijn gewijzigd sinds
 * `passesUpdatedSince`? iOS pollt dit na een push. We leiden de "gewijzigd op"
 * van een pas af uit de nieuwste loyalty-event van die klant (het saldo = de
 * pas-inhoud). Geen wijzigingen → 204. Dit endpoint kent GEEN auth-token
 * (spec: device-gescoped via de opaque deviceLibraryIdentifier).
 */

type Params = { params: Promise<{ deviceLibraryIdentifier: string }> };

export async function GET(req: Request, { params }: Params) {
  const { deviceLibraryIdentifier } = await params;
  const sinceRaw = new URL(req.url).searchParams.get("passesUpdatedSince");
  const sinceMs = sinceRaw && /^\d+$/.test(sinceRaw) ? Number(sinceRaw) : 0;

  try {
    const db = getDb();
    const regs = await db
      .select({ serialNumber: walletAppleRegistrations.serialNumber })
      .from(walletAppleRegistrations)
      .where(eq(walletAppleRegistrations.deviceLibraryIdentifier, deviceLibraryIdentifier));
    const serials = regs.map((r) => r.serialNumber);
    if (!serials.length) return new Response(null, { status: 204 });

    // Nieuwste event-tijd per klant (= pas-serial).
    const rows = await db
      .select({ customerId: loyaltyEvents.customerId, updated: max(loyaltyEvents.createdAt) })
      .from(loyaltyEvents)
      .where(inArray(loyaltyEvents.customerId, serials))
      .groupBy(loyaltyEvents.customerId);

    let lastUpdated = sinceMs;
    const changed: string[] = [];
    for (const r of rows) {
      const ms = r.updated ? new Date(r.updated as unknown as string).getTime() : 0;
      if (ms > sinceMs) {
        changed.push(String(r.customerId));
        if (ms > lastUpdated) lastUpdated = ms;
      }
    }
    if (!changed.length) return new Response(null, { status: 204 });
    return Response.json({ lastUpdated: String(lastUpdated), serialNumbers: changed });
  } catch (e) {
    console.error("[wallet/v1/serials]", (e as Error).message);
    return new Response(null, { status: 500 });
  }
}
