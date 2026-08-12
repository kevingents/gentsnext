import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { rateLimit, fingerprint } from "@/lib/rate-limit";
import { validateVoucher, redeemVoucherForRef, releaseVoucherForRef, activeVouchersForCustomer } from "@/lib/vouchers";
import { redeemableBalance, redeemPointsForVoucher } from "@/lib/loyalty-claim";
import { getSettings } from "@/lib/settings";

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
 *   punten-opties { customerId }                → { ok, besteedbaar, minPoints, stepPoints, centsPerPoint, opties:[{points,valueCents}] }
 *     Wat kan deze klant NU inwisselen. De kassa toont dat zodra de klant aan de
 *     bon hangt, zodat de kassier het aanbiedt in plaats van dat de klant thuis
 *     eerst zelf een code moet aanmaken.
 *
 *   punten-inwisselen { customerId, points }    → { ok, code, valueCents, points, error? }
 *     Boekt de punten af en maakt er een tegoedbon van. De kassa zet die code
 *     daarna in het gewone voucher-slot van de bon, dus verzilveren loopt via
 *     precies dezelfde weg als een code die de klant meebrengt.
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

  let b: { action?: string; code?: string; ref?: string; subtotalCents?: number; customerId?: string; email?: string; points?: number };
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
      case "punten-opties": {
        const klant = String(b.customerId || "");
        if (!klant) return NextResponse.json({ ok: false, error: "customerId vereist." }, { status: 400 });
        const lc = (await getSettings()).loyaltyConfig;
        const centsPerPoint = Number(lc?.redeemCentsPerPoint) > 0 ? Number(lc.redeemCentsPerPoint) : 5;
        const minPoints = Number(lc?.redeemMinPoints) > 0 ? Number(lc.redeemMinPoints) : 500;
        const stepPoints = lc?.redeemStepPoints == null ? 500 : Math.max(0, Number(lc.redeemStepPoints));
        const besteedbaar = Math.max(0, await redeemableBalance(klant));
        /* Alleen hele stappen die de klant ECHT heeft. Zelfde regels als de
           webshop-inwissel; de server rekent, de kassa toont alleen. Bewust
           afgekapt op 5 keuzes: een kassascherm is geen keuzemenu. */
        const opties: { points: number; valueCents: number }[] = [];
        if (besteedbaar >= minPoints) {
          const stap = stepPoints > 0 ? stepPoints : minPoints;
          for (let p = minPoints; p <= besteedbaar && opties.length < 5; p += stap) {
            opties.push({ points: p, valueCents: p * centsPerPoint });
          }
          opties.reverse(); // hoogste eerst: dat is wat de klant meestal wil
        }
        return NextResponse.json({ ok: true, besteedbaar, minPoints, stepPoints, centsPerPoint, opties });
      }
      case "punten-inwisselen": {
        const klant = String(b.customerId || "");
        if (!klant) return NextResponse.json({ ok: false, error: "customerId vereist." }, { status: 400 });
        /* redeemPointsForVoucher is de ENIGE plek waar punten in een bon veranderen
           (ook voor de webshop): atomaire afboeking op het geveste saldo, en bij een
           fout draait 'ie de afboeking én het grootboek-event terug. Niet nabouwen. */
        const r = await redeemPointsForVoucher(klant, Number(b.points));
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
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
