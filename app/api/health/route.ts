import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const result: { ok: boolean; time: string; db: string } = {
    ok: true,
    time: new Date().toISOString(),
    db: "unknown",
  };
  try {
    await getDb().execute(sql`select 1`);
    result.db = "up";
  } catch (error) {
    result.ok = false;
    result.db = error instanceof Error ? error.message : "error";
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
