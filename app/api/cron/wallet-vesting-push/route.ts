import { NextResponse } from "next/server";
import { and, gt, lte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { walletAppleRegistrations, loyaltyEvents } from "@/db/schema";
import { walletConfigured } from "@/lib/apple-wallet-config";
import { pushPassUpdate } from "@/lib/apple-wallet-push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Dagelijkse Apple-Wallet-verversing voor NET GEVESTE punten. Vesting is puur
 * tijd-gebaseerd (vests_at ≤ now) en maakt geen loyalty-event aan, dus geen
 * enkele mutatie triggert dan een pas-update. Deze cron zoekt klanten met een
 * Wallet-registratie wier punten in de afgelopen ~25u vestten en pusht die
 * eenmalig, zodat het besteedbare saldo op de pas prompt klopt.
 *
 * Vercel stuurt `Authorization: Bearer <CRON_SECRET>`. Env-gated: no-op zonder
 * pass-certificaat.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const url = new URL(req.url);
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!walletConfigured()) return NextResponse.json({ ok: true, skipped: "wallet-niet-geconfigureerd", pushed: 0 });

  try {
    const db = getDb();
    // Passen (serials) die een device geregistreerd hebben.
    const regs = await db
      .selectDistinct({ serial: walletAppleRegistrations.serialNumber })
      .from(walletAppleRegistrations);
    const serials = regs.map((r) => r.serial);
    if (!serials.length) return NextResponse.json({ ok: true, pushed: 0, candidates: 0 });

    // Van die klanten: wie is in de afgelopen ~25u gevest?
    const vested = await db
      .selectDistinct({ customerId: loyaltyEvents.customerId })
      .from(loyaltyEvents)
      .where(
        and(
          inArray(loyaltyEvents.customerId, serials),
          gt(loyaltyEvents.vestsAt, sql`now() - interval '25 hours'`),
          lte(loyaltyEvents.vestsAt, sql`now()`),
        ),
      );

    let pushed = 0;
    for (const v of vested) pushed += await pushPassUpdate(String(v.customerId)).catch(() => 0);
    return NextResponse.json({ ok: true, candidates: vested.length, pushed });
  } catch (e) {
    console.error("[cron/wallet-vesting-push]", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
