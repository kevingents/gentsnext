import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { enqueuePrintJob, pendingPrintJobs, markPrintJobDone, requeuePrintJob, listPrintJobHistory } from "@/lib/print-inbox";

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

  let b: { action?: string; store?: string; type?: string; ref?: string; payload?: unknown; createdBy?: string; id?: string; limit?: number; mode?: string };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const action = String(b?.action || "");

  try {
    switch (action) {
      case "enqueue":
        /* mode 'once' (dedup op store+ref+type) ook via de bridge beschikbaar —
           de SRS-weborder-keukenbon (storegents-cron) leunt hierop. */
        return NextResponse.json(await enqueuePrintJob({ store: String(b.store || ""), type: b.type, ref: b.ref, payload: b.payload, createdBy: b.createdBy, mode: b.mode === "once" ? "once" : undefined }));
      case "pending":
        return NextResponse.json({ ok: true, jobs: await pendingPrintJobs(String(b.store || ""), b.limit) });
      case "ack":
        return NextResponse.json(await markPrintJobDone(String(b.id || ""), String(b.store || "")));
      /* Herprint + historie (verwerkte orders in de kassa, 6 aug). */
      case "requeue":
        return NextResponse.json(await requeuePrintJob(String(b.store || ""), String(b.ref || "")));
      case "history":
        return NextResponse.json({ ok: true, jobs: await listPrintJobHistory(String(b.store || ""), String(b.ref || ""), b.limit) });
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${action}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
