import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import {
  recordOpeningCore, getOpeningCore, claimOpeningSrsCore, releaseOpeningSrsCore,
  markOpeningSrsCore, backfillOpeningsCore,
} from "@/lib/pos-openings-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/pos-opening — kas-openingen (beginkas-telling) in de Neon-core
 * (vervangt de storegents-blob admin/kassa-openings.json). Action-based.
 * Auth: STORE_CORE_TOKEN.
 *
 *   record      { store, date, opening }  → { ok, opening }   (upsert + audit-spoor)
 *   get         { store, date }           → { ok, opening }   (opening = null als niet geteld)
 *   claim-srs   { store, date }           → { ok, uitkomst }  (geclaimd | al-bezet | mislukt, ATOMAIR)
 *   release-srs { store, date }           → { ok, released }
 *   mark-srs    { store, date, srs }      → { ok, stempel }   (stempel = null als al geboekt)
 *   backfill    { openings }              → { ok, inserted }  (eenmalige blob-migratie)
 *
 * NB: query-acties antwoorden ok:true óók bij "niet gevonden" — de storegents-
 * bridge (corePost) leest ok:false als storing en zou anders onnodig op de
 * blob-fallback terugvallen.
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: {
    action?: string; store?: string; date?: string;
    opening?: Record<string, unknown>; openings?: Record<string, unknown>[];
    srs?: { bonnr?: string; amount?: number };
  };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const action = String(b?.action || "");
  const store = String(b?.store || "").trim();
  const date = String(b?.date || "").trim();

  try {
    switch (action) {
      case "record":
        return NextResponse.json(await recordOpeningCore({ store, date, opening: b.opening }));
      case "get":
        return NextResponse.json({ ok: true, opening: await getOpeningCore(store, date) });
      case "claim-srs":
        return NextResponse.json({ ok: true, uitkomst: await claimOpeningSrsCore(store, date) });
      case "release-srs":
        return NextResponse.json(await releaseOpeningSrsCore(store, date));
      case "mark-srs":
        return NextResponse.json({ ok: true, stempel: await markOpeningSrsCore(store, date, b.srs || {}) });
      case "backfill":
        return NextResponse.json(await backfillOpeningsCore(b.openings || []));
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${action}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
