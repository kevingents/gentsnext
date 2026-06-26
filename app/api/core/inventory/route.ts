import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import {
  startInventorySession, scanInventory, deleteInventoryCount, getInventorySession,
  listInventorySessions, completeInventorySession, applyInventoryVariances,
} from "@/lib/inventory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/inventory — inventarisatie (telsessie) voor de handscanner.
 * Auth: STORE_CORE_TOKEN. Eén endpoint, action-based:
 *   { action: "start", location, type?, section?, note?, startedBy? }
 *   { action: "scan", sessionId, code, qty? }      → count + variance
 *   { action: "get", sessionId }                   → session + counts
 *   { action: "list", location, limit? }           → sessions
 *   { action: "complete", sessionId, completedBy? }→ summary
 *   { action: "apply", sessionId }                 → varianties als correctie boeken
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: { action?: string; location?: string; type?: string; section?: string; note?: string; startedBy?: string; sessionId?: string; code?: string; qty?: number; mode?: string; stockKey?: string; completedBy?: string; limit?: number };
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const action = String(b?.action || "");

  try {
    switch (action) {
      case "start": {
        if (!b.location) return NextResponse.json({ ok: false, error: "location vereist." }, { status: 400 });
        const session = await startInventorySession({ location: b.location, type: b.type, section: b.section, note: b.note, startedBy: b.startedBy });
        return NextResponse.json({ ok: true, session });
      }
      case "scan": {
        if (!b.sessionId || !b.code) return NextResponse.json({ ok: false, error: "sessionId + code vereist." }, { status: 400 });
        return NextResponse.json(await scanInventory({ sessionId: b.sessionId, code: b.code, qty: b.qty, mode: b.mode }));
      }
      case "delete": {
        if (!b.sessionId || !b.stockKey) return NextResponse.json({ ok: false, error: "sessionId + stockKey vereist." }, { status: 400 });
        return NextResponse.json(await deleteInventoryCount({ sessionId: b.sessionId, stockKey: b.stockKey }));
      }
      case "get": {
        if (!b.sessionId) return NextResponse.json({ ok: false, error: "sessionId vereist." }, { status: 400 });
        const r = await getInventorySession(b.sessionId);
        return r ? NextResponse.json({ ok: true, ...r }) : NextResponse.json({ ok: false, error: "Niet gevonden." }, { status: 404 });
      }
      case "list": {
        if (!b.location) return NextResponse.json({ ok: false, error: "location vereist." }, { status: 400 });
        return NextResponse.json({ ok: true, sessions: await listInventorySessions(b.location, b.limit) });
      }
      case "complete": {
        if (!b.sessionId) return NextResponse.json({ ok: false, error: "sessionId vereist." }, { status: 400 });
        return NextResponse.json({ ok: true, ...(await completeInventorySession(b.sessionId, b.completedBy)) });
      }
      case "apply": {
        if (!b.sessionId) return NextResponse.json({ ok: false, error: "sessionId vereist." }, { status: 400 });
        return NextResponse.json(await applyInventoryVariances(b.sessionId));
      }
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${action}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
