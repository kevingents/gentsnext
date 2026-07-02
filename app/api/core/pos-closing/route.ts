import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import {
  recordClosingCore, getClosingCore, getLastClosingCore, listClosingsCore,
  markClosingMailedCore, listClosingsForStoresCore,
} from "@/lib/pos-closings-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/pos-closing — kassa-dagafsluitingen in de Neon-core (vervangt de
 * storegents-blob admin/kassa-closings.json). Action-based. Auth: STORE_CORE_TOKEN.
 *
 *   record      { store, date, dagstaat, kasopmaak, note?, actor?, closedAt? } → { ok, closing }
 *   get         { store, date }        → { ok, closing }
 *   last        { store }              → { ok, closing }
 *   list        { store, limit? }      → { ok, closings }
 *   mark-mailed { store, date, opts? } → { ok }
 *   for-stores  { stores, since }      → { ok, closings }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: {
    action?: string; store?: string; date?: string; dagstaat?: unknown; kasopmaak?: unknown;
    note?: string; actor?: unknown; closedAt?: string; limit?: number; opts?: { status?: string }; stores?: string[]; since?: string;
  };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const action = String(b?.action || "");

  try {
    switch (action) {
      case "record":
        return NextResponse.json(await recordClosingCore({
          store: String(b.store || ""), date: String(b.date || ""),
          dagstaat: b.dagstaat, kasopmaak: b.kasopmaak, note: b.note, actor: b.actor, closedAt: b.closedAt,
        }));
      case "get": {
        const c = await getClosingCore(String(b.store || ""), String(b.date || ""));
        return NextResponse.json({ ok: !!c, closing: c });
      }
      case "last": {
        const c = await getLastClosingCore(String(b.store || ""));
        return NextResponse.json({ ok: !!c, closing: c });
      }
      case "list":
        return NextResponse.json({ ok: true, closings: await listClosingsCore(String(b.store || ""), b.limit) });
      case "mark-mailed":
        return NextResponse.json(await markClosingMailedCore(String(b.store || ""), String(b.date || ""), b.opts || {}));
      case "for-stores":
        return NextResponse.json({ ok: true, closings: await listClosingsForStoresCore(b.stores || [], String(b.since || "")) });
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${action}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
