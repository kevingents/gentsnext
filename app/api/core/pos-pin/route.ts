import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import {
  createMollieTerminalPayment,
  getMolliePayment,
  cancelMolliePayment,
  listMollieTerminals,
  mollieConfigured,
} from "@/lib/mollie";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Core-API pinbetaling op een FYSIEKE Mollie-terminal (point-of-sale) — de kassa
 * (storegents) start/pollt/annuleert hiermee een pinbetaling met ECHT geld. De
 * Mollie-secret zit alleen hier (gentsnext, lib/mollie.ts); de kassa praat via de
 * storegents-proxy naar dit endpoint. Auth: STORE_CORE_TOKEN of admin
 * (zelfde patroon als /api/core/afspraken).
 *
 * POST { action, ... }
 *   action:"start"  { amountCents, description, terminalId, clientRef, metadata? }
 *                   → { ok, paymentId, status }
 *   action:"status" { paymentId } → { ok, status, paid, amountCents }
 *   action:"cancel" { paymentId } → { ok, status }
 * GET  → { ok, terminals:[...] }  (voor de config-UI: terminalId opzoeken)
 *
 * GELD-VEILIGHEID:
 *  - start gebruikt Idempotency-Key = clientRef → een retry maakt NOOIT een 2e
 *    betaling (Mollie geeft dezelfde betaling terug).
 *  - status is puur read-only (pollt de Mollie-status); boekt zelf niets.
 *  - GEEN geheimen of PAN in de response — alleen id/status/bedrag.
 */

type StartBody = {
  action?: string;
  amountCents?: number;
  description?: string;
  terminalId?: string;
  clientRef?: string;
  paymentId?: string;
  metadata?: Record<string, unknown>;
};

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: Request) {
  if (!(await coreAuth(req))) return bad("Geen toegang.", 403);
  if (!mollieConfigured()) return bad("Mollie niet geconfigureerd.", 200);
  try {
    const terminals = await listMollieTerminals();
    return NextResponse.json({ ok: true, terminals });
  } catch (e) {
    return bad((e as Error).message, 500);
  }
}

export async function POST(req: Request) {
  if (!(await coreAuth(req))) return bad("Geen toegang.", 403);
  if (!mollieConfigured()) return bad("Mollie niet geconfigureerd.", 200);

  let body: StartBody;
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return bad("Ongeldige body.");
  }

  const action = String(body?.action || "").trim();

  try {
    if (action === "start") {
      const amountCents = Math.round(Number(body?.amountCents) || 0);
      const terminalId = String(body?.terminalId || "").trim();
      const clientRef = String(body?.clientRef || "").trim();
      const description = String(body?.description || "Kassa GENTS").slice(0, 100);
      if (amountCents <= 0) return bad("Ongeldig bedrag.");
      if (!terminalId) return bad("Geen terminalId (Mollie-terminal niet ingesteld).");
      if (!clientRef) return bad("clientRef vereist (idempotentie).");

      // Idempotency-Key = clientRef: een retry na netwerkfout hergebruikt dezelfde
      // sleutel → Mollie maakt geen tweede betaling. Metadata dragen we door zodat
      // een betaling terug te herleiden is naar de kassa-verkoop (audit/reconcile).
      const payment = await createMollieTerminalPayment({
        amountCents,
        description,
        terminalId,
        metadata: {
          ...(body?.metadata && typeof body.metadata === "object" ? body.metadata : {}),
          source: "pos-terminal",
          clientRef,
        },
        idempotencyKey: clientRef.slice(0, 40),
      });
      return NextResponse.json({ ok: true, paymentId: payment.id, status: payment.status });
    }

    if (action === "status") {
      const paymentId = String(body?.paymentId || "").trim();
      if (!paymentId) return bad("paymentId vereist.");
      const p = await getMolliePayment(paymentId);
      const amountCents = Math.round(parseFloat(p.amount?.value || "0") * 100);
      return NextResponse.json({ ok: true, status: p.status, paid: p.status === "paid", amountCents });
    }

    if (action === "cancel") {
      const paymentId = String(body?.paymentId || "").trim();
      if (!paymentId) return bad("paymentId vereist.");
      const r = await cancelMolliePayment(paymentId);
      // ok:false van cancel is voor de kassa geen 500 waard: een niet-meer-annuleerbare
      // betaling (al betaald/verlopen) wordt door de poll-guard afgevangen. We geven de
      // ruwe uitkomst terug zodat de kassa het weet, maar breken de flow niet.
      return NextResponse.json({ ok: r.ok, status: r.status ?? null, error: r.ok ? undefined : r.error });
    }

    return bad("Onbekende action.");
  } catch (e) {
    return bad((e as Error).message, 500);
  }
}
