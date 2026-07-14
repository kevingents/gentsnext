import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { listAppointmentsForStore, updateAppointmentStatus } from "@/lib/appointments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Core-API klantafspraken — de kassa (storegents) leest hiermee de afspraken
 * van de eigen winkel en werkt de status bij. Auth: STORE_CORE_TOKEN of
 * admin/STUDIO_API_TOKEN (zelfde patroon als /api/core/stock/by-branch).
 *
 * GET  ?store=GENTS Amsterdam[&from=yyyy-mm-dd&to=yyyy-mm-dd]
 *      → { ok, items: [...] }  (default venster: vandaag t/m +14d, oplopend op datum)
 *      PII-arm: naam + telefoon (nodig om het tijdstip af te stemmen), géén e-mail.
 * POST { id, status } → { ok }  (status ∈ nieuw|bevestigd|afgerond|no-show|geannuleerd)
 */
export async function GET(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const url = new URL(req.url);
  const store = url.searchParams.get("store") || "";
  if (!store.trim()) {
    return NextResponse.json({ ok: false, error: "store vereist." }, { status: 400 });
  }
  try {
    const items = await listAppointmentsForStore(store, url.searchParams.get("from") || undefined, url.searchParams.get("to") || undefined);
    if (items === null) {
      return NextResponse.json({ ok: false, error: "Onbekende winkel." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { id?: string; status?: string };
  try {
    body = (await req.json()) as { id?: string; status?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  try {
    const res = await updateAppointmentStatus(String(body?.id || ""), String(body?.status || ""));
    if (!res.ok) return NextResponse.json(res, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
