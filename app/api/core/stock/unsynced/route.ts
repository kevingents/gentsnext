import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { unsyncedMovementStats } from "@/lib/store-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/core/stock/unsynced — SRS-sync-achterstand in het mutatie-grootboek,
 * voor de drift-monitor (storegents cron srs-sync-monitor). Read-only.
 *
 * De kassa rekent: beschikbaar = SRS-baseline + Σ deltas met srs_posted_at IS NULL.
 * Twee blinde vlekken die dit endpoint zichtbaar maakt:
 *  1. pos/inbound/transfer-movements die LANG unsynced blijven = een gemiste
 *     SRS-boeking (boekMovementToSrs faalde stil, of de vlag stond uit) → SRS
 *     drift stil weg van Neon.
 *  2. 'correction'-movements (inventarisatie, handmatige correctie, niet-leverbaar)
 *     kunnen per definitie nooit naar SRS — verwacht, maar het volume is de
 *     werklijst "nog handmatig in SRS door te voeren".
 *
 * Query: ?olderThanHours=24 (default 24) — drempel voor de stale-lijst.
 * Auth: STORE_CORE_TOKEN of admin/STUDIO_API_TOKEN (zelfde als de andere core-routes).
 *
 * → { ok, olderThanHours,
 *      channels: [{ channel, count, sumAbsDelta, oldestCreatedAt }],   // alle kanalen
 *      stale:    [{ location, channel, ref, lines, sumAbsDelta, oldestCreatedAt }],
 *                                                  // pos/inbound/transfer > drempel, max 200
 *      correction: { count, sumAbsDelta, oldestCreatedAt } }           // verwacht-unsynced
 */
export async function GET(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const url = new URL(req.url);
  const raw = Number(url.searchParams.get("olderThanHours"));
  const olderThanHours = Number.isFinite(raw) && raw > 0 ? Math.min(Math.round(raw), 24 * 90) : 24;
  try {
    const { channels, stale } = await unsyncedMovementStats(olderThanHours, 200);
    const corr = channels.find((c) => c.channel === "correction");
    return NextResponse.json({
      ok: true,
      olderThanHours,
      channels,
      stale,
      correction: {
        count: corr?.count || 0,
        sumAbsDelta: corr?.sumAbsDelta || 0,
        oldestCreatedAt: corr?.oldestCreatedAt || null,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
