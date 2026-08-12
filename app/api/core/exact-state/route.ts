import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import {
  getExactState,
  putExactState,
  delExactState,
  claimExactRefresh,
  releaseExactRefresh,
} from "@/lib/exact-state-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/exact-state — Exact Online-koppelingsstatus in de Neon-core
 * (vervangt de storegents-blobs exact/*.json). Action-based, zelfde patroon als
 * pos-closing. Auth: STORE_CORE_TOKEN.
 *
 *   get             { key }               → { ok, value }        (value = null als afwezig)
 *   put             { key, value }        → { ok }
 *   del             { key }               → { ok }
 *   claim-refresh   { owner, leaseMs? }   → { ok, won }
 *   release-refresh { owner }             → { ok }
 *
 * De values zijn hier opaak: de OAuth-tokens komen al AES-versleuteld binnen
 * (storegents versleutelt met een sleutel die alleen dáár staat), dus deze laag
 * — en de database — ziet nooit een leesbare token. Het refresh-slot is de
 * reden dat dit naar Postgres moest: Exacts eenmalige refresh-token verdraagt
 * geen twee gelijktijdige verversers (11-8-2026: "Old refresh token used").
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: { action?: string; key?: string; value?: unknown; owner?: string; leaseMs?: number };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const action = String(b?.action || "");
  const key = String(b?.key || "").trim();

  try {
    switch (action) {
      case "get": {
        if (!key) return NextResponse.json({ ok: false, error: "key is verplicht." }, { status: 400 });
        return NextResponse.json({ ok: true, value: await getExactState(key) });
      }
      case "put": {
        if (!key) return NextResponse.json({ ok: false, error: "key is verplicht." }, { status: 400 });
        if (b.value === undefined) return NextResponse.json({ ok: false, error: "value is verplicht." }, { status: 400 });
        await putExactState(key, b.value);
        return NextResponse.json({ ok: true });
      }
      case "del": {
        if (!key) return NextResponse.json({ ok: false, error: "key is verplicht." }, { status: 400 });
        await delExactState(key);
        return NextResponse.json({ ok: true });
      }
      case "claim-refresh": {
        const owner = String(b.owner || "").trim();
        if (!owner) return NextResponse.json({ ok: false, error: "owner is verplicht." }, { status: 400 });
        const won = await claimExactRefresh(owner, Number(b.leaseMs) || 25_000);
        return NextResponse.json({ ok: true, won });
      }
      case "release-refresh": {
        const owner = String(b.owner || "").trim();
        if (!owner) return NextResponse.json({ ok: false, error: "owner is verplicht." }, { status: 400 });
        await releaseExactRefresh(owner);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${action}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
