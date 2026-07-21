import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { walletAppleRegistrations } from "@/db/schema";
import { verifyPassAuth, walletConfigured } from "@/lib/apple-wallet-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PassKit web service — device (de)registratie voor de GENTS-spaarpas.
 *   POST   …/registrations/{passTypeId}/{serialNumber}   body { pushToken }
 *   DELETE …/registrations/{passTypeId}/{serialNumber}
 * Auth = `Authorization: ApplePass <token>`, waarbij token = onze per-pas
 * HMAC (verifyPassAuth). serialNumber = customerId = de pas-serial.
 */

type Params = { params: Promise<{ deviceLibraryIdentifier: string; passTypeIdentifier: string; serialNumber: string }> };

function authOk(req: Request, serial: string): boolean {
  const h = req.headers.get("authorization") || "";
  const m = /^ApplePass\s+(.+)$/i.exec(h.trim());
  return Boolean(m && verifyPassAuth(serial, m[1]));
}

export async function POST(req: Request, { params }: Params) {
  // Fail-closed: staat de wallet niet aan, dan geen (onauthenticeerde) writes op
  // de registratietabel — anders is dit een open schrijf-endpoint.
  if (!walletConfigured()) return new Response(null, { status: 503 });
  const { deviceLibraryIdentifier, serialNumber } = await params;
  if (!authOk(req, serialNumber)) return new Response(null, { status: 401 });

  let pushToken = "";
  try {
    const body = (await req.json()) as { pushToken?: string };
    pushToken = String(body?.pushToken || "").trim();
  } catch {
    /* lege/ongeldige body → hieronder afvangen */
  }
  if (!pushToken) return new Response(null, { status: 400 });

  try {
    const db = getDb();
    // Bestaat er al een registratie (voor de 201-vs-200-statuscode)? Daarna een
    // atomaire upsert: twee gelijktijdige registraties van hetzelfde device
    // (neon-http = geen transactie) mogen niet op de composite-PK crashen.
    const existing = await db
      .select({ t: walletAppleRegistrations.pushToken })
      .from(walletAppleRegistrations)
      .where(
        and(
          eq(walletAppleRegistrations.deviceLibraryIdentifier, deviceLibraryIdentifier),
          eq(walletAppleRegistrations.serialNumber, serialNumber),
        ),
      )
      .limit(1);
    await db
      .insert(walletAppleRegistrations)
      .values({ deviceLibraryIdentifier, serialNumber, pushToken })
      .onConflictDoUpdate({
        target: [walletAppleRegistrations.deviceLibraryIdentifier, walletAppleRegistrations.serialNumber],
        set: { pushToken },
      });
    return new Response(null, { status: existing.length ? 200 : 201 });
  } catch (e) {
    console.error("[wallet/v1/register]", (e as Error).message);
    return new Response(null, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const { deviceLibraryIdentifier, serialNumber } = await params;
  if (!authOk(req, serialNumber)) return new Response(null, { status: 401 });
  try {
    const db = getDb();
    await db
      .delete(walletAppleRegistrations)
      .where(
        and(
          eq(walletAppleRegistrations.deviceLibraryIdentifier, deviceLibraryIdentifier),
          eq(walletAppleRegistrations.serialNumber, serialNumber),
        ),
      );
    return new Response(null, { status: 200 });
  } catch (e) {
    console.error("[wallet/v1/unregister]", (e as Error).message);
    return new Response(null, { status: 500 });
  }
}
