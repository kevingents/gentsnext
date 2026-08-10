import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { processStockNotifications, processStaleStockNotifications } from "@/lib/stock-notify";
import { cronSecretOk } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Terug-op-voorraad-cron (zie vercel.json). Vercel stuurt automatisch
 * `Authorization: Bearer <CRON_SECRET>`; een ingelogde beheerder mag 'm ook handmatig
 * openen. Twee stappen:
 *  1. maten die wéér op voorraad zijn → de aangemelde klanten melden (mail/WhatsApp);
 *  2. meldingen die na de ingestelde wachttijd (default 14 dagen) nog niet terug zijn
 *     → een alternatief-op-maat sturen dat wél op voorraad is.
 * De hele flow (aan/uit, kanalen, wachttijd) is instelbaar via de portal (settings-store).
 */
export async function GET(req: Request) {
  const viaCron = cronSecretOk(req);
  const customer = viaCron ? null : await getSessionCustomer();
  if (!viaCron && !customer?.isAdmin) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const restocked = await processStockNotifications();
    const alternatives = await processStaleStockNotifications();
    return NextResponse.json({ ok: true, restocked, alternatives });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "cron-fout" }, { status: 500 });
  }
}
