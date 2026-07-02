import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { enqueuePrintJob, pendingPrintJobs, markPrintJobDone } from "@/lib/print-inbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/print-inbox — print-opdracht-wachtrij per winkel (auth: STORE_CORE_TOKEN).
 *   enqueue { store, type?, ref?, payload?, createdBy? } → { ok, job }
 *   pending { store, limit? }                           → { ok, jobs }
 *   ack     { id, store }                               → { ok }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: { action?: string; store?: string; type?: string; ref?: string; payload?: unknown; createdBy?: string; id?: string; limit?: number };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const action = String(b?.action || "");

  try {
    switch (action) {
      case "enqueue":
        return NextResponse.json(await enqueuePrintJob({ store: String(b.store || ""), type: b.type, ref: b.ref, payload: b.payload, createdBy: b.createdBy }));
      case "pending":
        return NextResponse.json({ ok: true, jobs: await pendingPrintJobs(String(b.store || ""), b.limit) });
      case "ack":
        return NextResponse.json(await markPrintJobDone(String(b.id || ""), String(b.store || "")));
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${action}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
