import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { syncCatalogFlags } from "@/lib/catalog-flags";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Catalogus-vlaggen verversen (zie vercel.json). Vercel stuurt automatisch
 * `Authorization: Bearer <CRON_SECRET>`; een ingelogde beheerder mag 'm ook
 * handmatig openen.
 *
 * Waarom een cron: has_image/in_stock/stock_qty sturen de hele listing aan
 * (PLP-filter, maat-facetten, zoeken, ranking) maar werden alleen bijgewerkt als
 * iemand met de hand `npm run sync:catalog` draaide. Op 12 aug 2026 stonden ze
 * 15 dagen stil. Ritme: elke 4 uur, ruim boven de ±3×/dag SRS-voorraadsync.
 *
 * Verstuurt bewust GEEN terug-op-voorraad-mails: die blijven bij
 * /api/cron/stock-check, zodat er maar één afzender is.
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
    const t0 = Date.now();
    const samenvatting = await syncCatalogFlags();
    return NextResponse.json({ ok: true, ...samenvatting, ms: Date.now() - t0 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "cron-fout" }, { status: 500 });
  }
}
