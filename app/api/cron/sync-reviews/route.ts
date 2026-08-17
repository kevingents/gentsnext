import { NextResponse } from "next/server";
import { syncJudgemeReviews, judgemeConfigured } from "@/lib/judgeme";
import { getSessionCustomer } from "@/lib/account";
import { cronSecretOk } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Nachtelijke Judge.me-review-sync (zie vercel.json). Vercel-cron stuurt
 * automatisch `Authorization: Bearer <CRON_SECRET>`. Een ingelogde beheerder
 * mag 'm ook handmatig starten (door deze URL te openen). Slechte reviews
 * (rating < minRating, default 4) worden niet geïmporteerd.
 */
export async function GET(req: Request) {
  const viaCron = cronSecretOk(req);
  const customer = viaCron ? null : await getSessionCustomer();
  if (!viaCron && !customer?.isAdmin) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!judgemeConfigured()) {
    return NextResponse.json({ ok: false, error: "JUDGEME_API ontbreekt" }, { status: 412 });
  }
  const url = new URL(req.url);
  const minRating = Number(url.searchParams.get("minRating")) || 4;
  const maxPages = Number(url.searchParams.get("maxPages")) || 100;
  try {
    const result = await syncJudgemeReviews({ minRating, maxPages });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "sync-fout" }, { status: 500 });
  }
}
