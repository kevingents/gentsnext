import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { rateLimit, fingerprint } from "@/lib/rate-limit";
import { validateVoucher, redeemVoucherForRef, releaseVoucherForRef, activeVouchersForCustomer } from "@/lib/vouchers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/voucher — tegoedbonnen/kortingscodes aan de kassa.
 * Auth: STORE_CORE_TOKEN.
 *
 *   list     { customerId?, email? }            → { ok, vouchers:[…] }
 *     Wat heeft deze klant openstaan. Bedoeld ná het scannen van de spaarpas:
 *     de QR op die pas bevat het klant-id, dus de kassa weet meteen wie er staat
 *     en hoeft de klant niets te laten voorlezen.
 *
 *   validate { code, subtotalCents }            → { ok, valid, discountCents, label, error? }
 *     Korting ALTIJD hier berekenen, nooit aan de kassa. Anders bepaalt de client
 *     hoeveel er van de prijs af mag.
 *
 *   redeem   { code, ref }                      → { ok, herhaald?, error? }
 *     Verzilvert atomair en idempotent op `ref` (de bon-id/clientRef). Dezelfde
 *     bon twee keer aanbieden is veilig; een andere bon met dezelfde code krijgt
 *     "al gebruikt".
 *
 *   release  { code, ref }                      → { ok }
 *     Draait een verzilvering terug die DEZELFDE ref maakte — voor een verkoop
 *     die na het verzilveren alsnog strandt. Een andere ref raakt niets aan.
 *
 * Verzilveren en pas dán afrekenen — niet andersom. Een code die wél van de prijs
 * ging maar niet verzilverd raakte, is gratis geld dat oneindig herbruikbaar is.
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  /* Backstop-rate-limit, zoals bij customer-search. Een voucher-code is toonder-
     papier: wie 'm heeft kan 'm uitgeven. Zou de gedeelde STORE_CORE_TOKEN ooit
     lekken, dan is `list` een geldkraan die je in bulk kunt leegtrekken. Frictie
     genoeg om dat op te laten vallen, ruim genoeg voor een drukke kassa. */
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const fp = fingerprint(`${req.headers.get("authorization") || ""}|${ip}`);
  const rl = rateLimit(`corevoucher:${fp}`, 120, 60_000);
  if (!rl.ok) {
    console.warn(`[core/voucher] rate-limit overschreden fp=${fp} count=${rl.count}/min`);
    return NextResponse.json({ ok: false, error: "Te veel verzoeken — even wachten." }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  }

  let b: { action?: string; code?: string; ref?: string; subtotalCents?: number; customerId?: string; email?: string };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const action = String(b?.action || "");

  try {
    switch (action) {
      case "list":
        return NextResponse.json({ ok: true, vouchers: await activeVouchersForCustomer({ customerId: b.customerId, email: b.email }) });
      case "validate": {
        const r = await validateVoucher(String(b.code || ""), Math.max(0, Number(b.subtotalCents) || 0));
        return NextResponse.json({ ok: true, ...r });
      }
      case "redeem": {
        const r = await redeemVoucherForRef(String(b.code || ""), String(b.ref || ""));
        return NextResponse.json(r, { status: r.ok ? 200 : 409 });
      }
      case "release":
        return NextResponse.json(await releaseVoucherForRef(String(b.code || ""), String(b.ref || "")));
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${action}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
