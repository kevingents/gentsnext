import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { createPosCustomer } from "@/lib/account";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/customer — gents.nl-klant aanmaken/aanvullen vanaf de kassa/scanner.
 * GEEN SRS-push (SRS = WMS). Auth: STORE_CORE_TOKEN.
 *
 *   create { email, firstName?, lastName?, phone? }
 *     → { ok, customer:{ customerId, email, name, firstName, lastName, phone } }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: { action?: string; email?: string; firstName?: string; lastName?: string; phone?: string };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  if (String(b?.action || "") !== "create") return NextResponse.json({ ok: false, error: "Onbekende actie." }, { status: 400 });

  try {
    const c = await createPosCustomer({ email: b.email || "", firstName: b.firstName, lastName: b.lastName, phone: b.phone });
    const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
    return NextResponse.json({
      ok: true,
      customer: { customerId: c.id, email: c.email, name, firstName: c.firstName || "", lastName: c.lastName || "", phone: c.phone || "" },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
