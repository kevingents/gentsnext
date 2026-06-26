import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { findOrCreateCustomer, issueProfileCompletionToken } from "@/lib/account";
import { sendProfileCompletionIncentiveEmail } from "@/lib/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/customer-incentive — "druk aan de kassa": mail de klant een
 * profiel-afrond-link voor +50 punten (de kassier vangt alleen het e-mailadres).
 * Idempotent: nieuwe token per call; +50 wordt pas bij afronden éénmalig toegekend.
 * Auth: STORE_CORE_TOKEN.
 *
 * Pre-launch gate: alleen versturen naar @gents.nl-testadressen, tenzij
 * PROFILE_INCENTIVE_ENABLED=1. Zo gaat er geen echte klantmail uit vóór go-live.
 *
 * Body: { email, firstName? } → { ok, sent, gated }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: { email?: string; firstName?: string };
  try { b = (await req.json()) as { email?: string; firstName?: string }; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const email = String(b?.email || "").trim().toLowerCase();
  if (!/.+@.+\..+/.test(email)) return NextResponse.json({ ok: false, error: "Geldig e-mailadres vereist." }, { status: 400 });
  const firstName = String(b?.firstName || "").trim();

  const c = await findOrCreateCustomer(email);
  const token = await issueProfileCompletionToken(c.id);

  const allowed = process.env.PROFILE_INCENTIVE_ENABLED === "1" || email.endsWith("@gents.nl");
  let sent = false;
  if (allowed) sent = await sendProfileCompletionIncentiveEmail(email, firstName || c.firstName || "", token);

  return NextResponse.json({ ok: true, sent, gated: !allowed });
}
