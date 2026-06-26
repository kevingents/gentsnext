import { NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { returns, returnLines } from "@/db/schema";
import { adminOrToken } from "@/lib/studio-token";
import { listReturns, processReturnReceived, getReturnStats, getReturnSignals, listAwaitingStockCorrection, markStockCorrected, listExpectedReturnsForStore, getReturnWithLines } from "@/lib/returns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Retour-beheer voor het portal ("Nieuwe site" → Retouren).
 *   GET  → recente retouren + regels.
 *   POST { action:"received", id } → retour ontvangen → vergoeden (Mollie-refund of tegoed).
 *        { action:"cancel", id }   → retour annuleren.
 * Auth: admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  const url = new URL(req.url);
  // Lichte variant voor het supply-chain dashboard: alleen de "terug te scannen"-worklist.
  if (url.searchParams.get("view") === "stock-queue") {
    try {
      return NextResponse.json({ ok: true, awaitingCorrection: await listAwaitingStockCorrection(200) });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }
  // Verwachte in-winkel-retouren voor één filiaal (kassa).
  if (url.searchParams.get("view") === "expected") {
    try {
      return NextResponse.json({ ok: true, expected: await listExpectedReturnsForStore(url.searchParams.get("store") || "", 200) });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }
  try {
    const rows = await listReturns(150);
    const db = getDb();
    const ids = rows.map((r) => r.id);
    const lines = ids.length ? await db.select().from(returnLines).where(inArray(returnLines.returnId, ids)) : [];
    const byRet = new Map<string, typeof lines>();
    for (const l of lines) {
      const arr = byRet.get(l.returnId) || [];
      arr.push(l);
      byRet.set(l.returnId, arr);
    }
    const items = rows.map((r) => ({ ...r, lines: byRet.get(r.id) || [] }));
    const [stats, signals, awaitingCorrection] = await Promise.all([getReturnStats(90), getReturnSignals(90), listAwaitingStockCorrection(150)]);
    return NextResponse.json({ ok: true, items, stats, signals, awaitingCorrection });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  let body: { action?: string; id?: string };
  try {
    body = (await req.json()) as { action?: string; id?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const id = String(body?.id || "");
  if (!id) return NextResponse.json({ ok: false, error: "Geen retour-id." }, { status: 400 });

  if (body.action === "received") {
    // Winkel-scope: als een filiaal de retour verwerkt, mag dat alleen z'n eigen
    // in-winkel-retour zijn. Admin (zonder store) mag elke retour verwerken.
    const store = String((body as { store?: string }).store || "").trim();
    if (store) {
      const rec = await getReturnWithLines(id);
      if (!rec) return NextResponse.json({ ok: false, error: "Retour niet gevonden." }, { status: 404 });
      if (rec.ret.method !== "store" || (rec.ret.pickupStore || "") !== store) {
        return NextResponse.json({ ok: false, error: "Deze retour hoort niet bij deze winkel." }, { status: 403 });
      }
    }
    const res = await processReturnReceived(id);
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  }
  if (body.action === "cancel") {
    const db = getDb();
    await db.update(returns).set({ status: "cancelled", updatedAt: sql`now()` }).where(eq(returns.id, id));
    return NextResponse.json({ ok: true, status: "cancelled" });
  }
  if (body.action === "stock_corrected") {
    const res = await markStockCorrected(id, (body as { by?: string }).by || "");
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  }
  return NextResponse.json({ ok: false, error: "Onbekende actie." }, { status: 400 });
}
