import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { recordKasMutatieCore, listKasMutatiesCore, backfillKasMutatiesCore } from "@/lib/pos-kas-mutaties-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/pos-kas-mutatie — kasmutaties (in/uit kas, in/uit kluis) in de
 * Neon-core (vervangt de storegents-blob admin/pos-kas-mutaties.json). Action-based.
 * Auth: STORE_CORE_TOKEN.
 *
 *   record   { mutatie }        → { ok, mutatie, deduped? }  (idempotent op id)
 *   list     { store, date }    → { ok, mutaties }
 *   backfill { mutaties }       → { ok, inserted }           (eenmalige blob-migratie)
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: { action?: string; mutatie?: Record<string, unknown>; mutaties?: Record<string, unknown>[]; store?: string; date?: string };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const action = String(b?.action || "");

  try {
    switch (action) {
      case "record":
        return NextResponse.json(await recordKasMutatieCore(b.mutatie || {}));
      case "list":
        return NextResponse.json({ ok: true, mutaties: await listKasMutatiesCore(String(b.store || ""), String(b.date || "")) });
      case "backfill":
        return NextResponse.json(await backfillKasMutatiesCore(b.mutaties || []));
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${action}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
