import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { syncPersonnelMirror, upsertPersonnelMirror, verifyPersonnelCode, type MirrorRowInput } from "@/lib/personnel-mirror-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/core/personnel-mirror — personeels-spiegel voor de snelle
 * kassacode-check (storegents). Kassacodes reizen en liggen hier alléén als
 * sha256(personnelId:code)-hash. Auth: STORE_CORE_TOKEN.
 *
 *   sync    { rows:[{personnelId,name,…,codeHash}] } → { ok, upserted, removed }
 *           (volledige set; verdwenen nummers worden opgeruimd, lege set geweigerd)
 *   upsert  { rows:[…] }                             → { ok, upserted }
 *           (write-through bij kassacode-reset / self-heal na SRS-fallback)
 *   verify  { personnelId, codeHash }                → { ok, found, active, match, person }
 *           (person zonder hash; alleen een volledige match mag de live
 *            SRS-check overslaan — die beslissing ligt bij storegents)
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: { action?: string; rows?: unknown[]; personnelId?: string; codeHash?: string };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }

  try {
    switch (String(b?.action || "")) {
      case "sync": {
        const r = await syncPersonnelMirror(Array.isArray(b.rows) ? (b.rows as MirrorRowInput[]) : []);
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "upsert":
        return NextResponse.json(await upsertPersonnelMirror(Array.isArray(b.rows) ? (b.rows as MirrorRowInput[]) : []));
      case "verify": {
        const personnelId = String(b?.personnelId || "").trim();
        const codeHash = String(b?.codeHash || "").trim();
        if (!personnelId || !codeHash) {
          return NextResponse.json({ ok: false, error: "personnelId en codeHash vereist." }, { status: 400 });
        }
        return NextResponse.json(await verifyPersonnelCode({ personnelId, codeHash }));
      }
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${String(b?.action || "")}".` }, { status: 400 });
    }
  } catch (e) {
    console.error("[core/personnel-mirror]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Serverfout." }, { status: 500 });
  }
}
