import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/core/srs-import-status — laatste uitslag van de nachtelijke
 * SRS-artikelen-import (app_settings rij 'srs-import-status', gezet door
 * /api/cron/srs-nieuwe-artikelen bij élke run, geslaagd of niet).
 *
 * Voor de storegents-waakhond (cron srs-import-check): die meldt supply chain
 * zodra de laatste run faalde of te lang geleden is — precies het gat waardoor
 * de import wekenlang stil kon falen (SRS 403, Kevin 19 aug).
 *
 * Auth: STORE_CORE_TOKEN of admin/STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    const rows = await getDb().execute<{ data: Record<string, unknown>; updated_at: string }>(sql`
      select data, updated_at from app_settings where id = 'srs-import-status' limit 1`);
    const row = rows.rows[0] || null;
    return NextResponse.json({ ok: true, status: row?.data ?? null, updatedAt: row?.updated_at ?? null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
