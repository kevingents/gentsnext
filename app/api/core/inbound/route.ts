import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import {
  createInboundShipment, listInboundShipments, openInboundForStore, getInboundShipment,
  setShipmentStatus, startReceiving, scanReceipt, deleteReceiptCount, receiveShipment,
  inTransitQtyForStore, markInboundReceiptPosted, createInterstoreTransfer, resolveCode, type ExpectedLine,
} from "@/lib/inbound";
import { listOpenDiscrepancies, resolveDiscrepancy, getReceivingStats } from "@/lib/inbound-discrepancies";
import { adviseShipMethod } from "@/lib/transfer-routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/inbound — inbound goederenontvangst (F1). Action-based.
 * Auth: STORE_CORE_TOKEN. De storegents-BFF scoped op de eigen winkel (callerStoreScope).
 *
 *   create        { toStore, source?, sourceType?, linkRef?, parts?, expectedLines?|skuExpected?, status?, note?, createdBy? } → { ok, shipment }
 *   list          { toStore, status?, limit? }     → { ok, shipments }
 *   open          { toStore }                       → { ok, shipments }   (gepickt/onderweg/bezig)
 *   get           { id }                            → { ok, shipment, counts }
 *   set-status    { id, status, by? }               → { ok, shipment }
 *   start-receiving { id, by? }                     → { ok, shipment }
 *   scan          { shipmentId, code, qty?, mode? } → { ok, count }
 *   delete-count  { shipmentId, stockKey }          → { ok }
 *   receive       { id, receivedBy? }               → { ok, booked, lines }
 *   in-transit    { toStore, keys? }                → { ok, qty: { [stockKey]: n } }
 *   mark-srs-posted { id }                          → { ok }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: {
    action?: string; id?: string; shipmentId?: string; toStore?: string; status?: string; limit?: number;
    code?: string; qty?: number; mode?: string; stockKey?: string; by?: string; receivedBy?: string;
    keys?: string[]; source?: string; sourceType?: string; fromLocation?: string; fromStore?: string; linkRef?: string;
    parts?: number; expectedLines?: ExpectedLine[]; skuExpected?: { sku: string; expected: number }[];
    note?: string; createdBy?: string; days?: number;
    shipMethod?: string; plannedRouteDate?: string; urgent?: boolean;
  };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const action = String(b?.action || "");

  try {
    switch (action) {
      case "create":
        return NextResponse.json({ ok: true, shipment: await createInboundShipment({ ...b, toStore: String(b.toStore || "") }) });
      case "list":
        return NextResponse.json({ ok: true, shipments: await listInboundShipments(b.toStore || "", b.status, b.limit) });
      case "open":
        return NextResponse.json({ ok: true, shipments: await openInboundForStore(b.toStore || "") });
      case "get": {
        const r = await getInboundShipment(String(b.id || ""));
        return r ? NextResponse.json({ ok: true, ...r }) : NextResponse.json({ ok: false, error: "Niet gevonden." }, { status: 404 });
      }
      case "set-status":
        return NextResponse.json({ ok: true, shipment: await setShipmentStatus(String(b.id || ""), String(b.status || ""), b.by) });
      case "start-receiving":
        return NextResponse.json({ ok: true, shipment: await startReceiving(String(b.id || ""), b.by) });
      case "scan":
        return NextResponse.json(await scanReceipt({ shipmentId: String(b.shipmentId || ""), code: String(b.code || ""), qty: b.qty, mode: b.mode }));
      case "delete-count":
        return NextResponse.json(await deleteReceiptCount(String(b.shipmentId || ""), String(b.stockKey || "")));
      case "receive":
        return NextResponse.json(await receiveShipment(String(b.id || ""), b.receivedBy));
      case "transfer-out":
        return NextResponse.json(await createInterstoreTransfer({ fromStore: b.fromStore || "", toStore: b.toStore || "", expectedLines: b.expectedLines, skuExpected: b.skuExpected, createdBy: b.by, note: b.note, shipMethod: b.shipMethod, plannedRouteDate: b.plannedRouteDate, urgent: b.urgent }));
      case "ship-advice":
        return NextResponse.json({ ok: true, advice: await adviseShipMethod(b.fromStore || "", b.toStore || "", !!b.urgent) });
      case "resolve": {
        const m = await resolveCode(String(b.code || ""));
        return NextResponse.json({ ok: !!m, item: m });
      }
      case "in-transit": {
        const m = await inTransitQtyForStore(b.toStore || "", b.keys);
        return NextResponse.json({ ok: true, qty: Object.fromEntries(m) });
      }
      case "mark-srs-posted":
        await markInboundReceiptPosted(String(b.id || ""));
        return NextResponse.json({ ok: true });
      case "discrepancies":
        return NextResponse.json({ ok: true, discrepancies: await listOpenDiscrepancies(b.toStore || undefined, b.limit) });
      case "resolve-discrepancy":
        return NextResponse.json({ ok: true, discrepancy: await resolveDiscrepancy(String(b.id || ""), String(b.status || ""), b.by, b.note) });
      case "stats":
        return NextResponse.json({ ok: true, stats: await getReceivingStats(b.days) });
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${action}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
