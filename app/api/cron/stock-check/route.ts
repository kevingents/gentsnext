import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { processStockNotifications, processStaleStockNotifications } from "@/lib/stock-notify";

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
function secretOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  const url = new URL(req.url);
  return header === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  const customer = secretOk(req) ? null : await getSessionCustomer();
  if (!secretOk(req) && !customer?.isAdmin) {
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
