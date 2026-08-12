import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import {
  getLoyaltyAccountCore, getLoyaltyBalanceCore, listLoyaltyMutationsCore,
  mutateLoyaltyCore, reverseLoyaltySaleCore, backfillLoyaltyCore,
} from "@/lib/loyalty-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/loyalty — spaarpunten in de Neon-core (vervangt de storegents-
 * blob admin/loyalty-core.json). Action-based. Auth: STORE_CORE_TOKEN.
 *
 *   get-account    { customerId, limit? }   → { ok, customerId, name, balance, mutations }
 *   balance        { customerId }           → { ok, balance }
 *   list-mutations { customerId, limit? }   → { ok, mutations }
 *   mutate         { customerId, delta, reason?, saleId?, store?, name?, actor? }
 *                                           → { ok, balance, applied }   (idempotent op mutation_key)
 *   reverse-sale   { customerId, saleId, store?, actor? }
 *                                           → { ok, balance, applied }   (idempotent)
 *   backfill       { accounts:[{ customerId, name, balance, mutations:[…] }] }
 *                                           → { ok, accounts, accountsBackfilled, mutationsInserted }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: {
    action?: string; customerId?: string; limit?: number; delta?: number; reason?: string;
    saleId?: string; store?: string; name?: string; actor?: string;
    accounts?: Array<Record<string, unknown>>;
  };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const action = String(b?.action || "");

  try {
    switch (action) {
      case "get-account": {
        const acc = await getLoyaltyAccountCore(String(b.customerId || ""), b.limit);
        return NextResponse.json({ ok: true, ...acc });
      }
      case "balance":
        return NextResponse.json({ ok: true, balance: await getLoyaltyBalanceCore(String(b.customerId || "")) });
      case "list-mutations":
        return NextResponse.json({ ok: true, mutations: await listLoyaltyMutationsCore(String(b.customerId || ""), b.limit) });
      case "mutate": {
        const out = await mutateLoyaltyCore({
          customerId: String(b.customerId || ""), delta: Number(b.delta),
          reason: b.reason, saleId: b.saleId, store: b.store, name: b.name, actor: b.actor,
        });
        return NextResponse.json(out, { status: out.ok ? 200 : 400 });
      }
      case "reverse-sale": {
        const out = await reverseLoyaltySaleCore({
          customerId: String(b.customerId || ""), saleId: String(b.saleId || ""),
          store: b.store, actor: b.actor,
        });
        return NextResponse.json(out, { status: out.ok ? 200 : 400 });
      }
      case "backfill":
        return NextResponse.json(await backfillLoyaltyCore((b.accounts || []) as Parameters<typeof backfillLoyaltyCore>[0]));
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${action}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
