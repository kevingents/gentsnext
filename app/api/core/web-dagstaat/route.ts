import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getWebDagstaatCore } from "@/lib/web-dagstaat-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/web-dagstaat — de webshop-dagstaat voor de Exact-boeking in
 * storegents. Action-based, zelfde patroon als pos-closing. Auth: STORE_CORE_TOKEN.
 *
 *   get { date }  → { ok, date, orders, ordersTotalCents, giftcardUsedCents,
 *                     giftcardsSold, giftcardsSoldCents, moneyRefundsTotal }
 *
 * De kassa levert de winkel-dagstaten; dit is de online tegenhanger — samen
 * vullen ze de tussenrekeningen die de Mollie-settlements weer leegvegen.
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: { action?: string; date?: string };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const action = String(b?.action || "");

  try {
    switch (action) {
      case "get": {
        const date = String(b.date || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return NextResponse.json({ ok: false, error: "date (YYYY-MM-DD) is verplicht." }, { status: 400 });
        }
        return NextResponse.json(await getWebDagstaatCore(date));
      }
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${action}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
