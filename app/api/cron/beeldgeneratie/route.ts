import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { cronSecretOk } from "@/lib/cron-auth";
import { getMediaThemes } from "@/lib/media-themes";
import { generateMedia, getCredits } from "@/lib/media-generator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Vult automatisch de ontbrekende sfeerbeelden aan (zie vercel.json). Vercel
 * stuurt `Authorization: Bearer <CRON_SECRET>`; een ingelogde beheerder mag 'm
 * ook handmatig openen om een batch te forceren.
 *
 * Deze cron GEEFT GELD UIT (FASHN-credits), dus hij is drievoudig begrensd:
 *  1. perRun          — aantal beelden per run (past binnen de 300s van Vercel);
 *  2. maxCreditsPerRun — harde bovengrens, ook als een beeld duurder uitvalt;
 *  3. minCreditsLeft  — onder dit saldo doet de cron niets meer.
 * Alle drie staan in de portal (Presentatie → Beeldthema's), niet in env.
 *
 * Idempotent: hij pakt alleen producten met een LEEG doelslot, dus een dubbele
 * run maakt geen dubbele kosten en overschrijft nooit bestaand beeldmateriaal.
 */
export async function GET(req: Request) {
  const isCron = cronSecretOk(req);
  if (!isCron) {
    const customer = await getSessionCustomer();
    if (!customer?.isAdmin) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const { cron } = await getMediaThemes();
  if (!cron.enabled) {
    return NextResponse.json({ ok: true, skipped: "cron staat uit in de portal" });
  }

  // Noodrem vóór de eerste API-call: bij een laag saldo helemaal niet beginnen.
  const key = process.env.FASHN_API_KEY || "";
  if (!key) {
    return NextResponse.json({ ok: false, error: "FASHN_API_KEY ontbreekt" }, { status: 500 });
  }
  const credits = await getCredits(key);
  if (credits < cron.minCreditsLeft) {
    return NextResponse.json({
      ok: true,
      skipped: `saldo ${credits} onder de ondergrens ${cron.minCreditsLeft}`,
      credits,
    });
  }

  try {
    const lines: string[] = [];
    const res = await generateMedia({
      limit: cron.perRun,
      slot: cron.slot,
      maxCredits: cron.maxCreditsPerRun,
      minCreditsLeft: cron.minCreditsLeft,
      log: (l) => lines.push(l),
    });
    return NextResponse.json({
      ok: true,
      done: res.done,
      skipped: res.skipped,
      failed: res.failed,
      creditsUsed: res.creditsBefore - res.creditsAfter,
      creditsLeft: res.creditsAfter,
      stoppedBecause: res.stoppedBecause,
      items: res.items,
      log: lines,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "cron-fout" },
      { status: 500 }
    );
  }
}
