import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { updateSettings, type Settings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const NUM_FIELDS: (keyof Settings)[] = [
  "freeShippingCents", "shippingCents", "expressSurchargeCents",
  "warehouseCutoffHour", "storeCutoffHour",
  "standardMinDays", "standardMaxDays", "warehouseTransitDays", "storeExtraDays", "expressTransitDays",
  "retailSafetyStock", "warehouseSafetyStock",
];

/** Werkt de centrale instellingen bij — alleen voor beheerders. */
export async function POST(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "niet ingelogd" }, { status: 401 });
  if (!customer.isAdmin) return NextResponse.json({ ok: false, error: "geen beheerrechten" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }

  const patch: Partial<Settings> = {};
  for (const f of NUM_FIELDS) {
    const v = body[f];
    if (v != null && Number.isFinite(Number(v))) (patch as Record<string, number>)[f] = Math.max(0, Math.round(Number(v)));
  }
  if (typeof body.protectUnderstockedRetail === "boolean") patch.protectUnderstockedRetail = body.protectUnderstockedRetail;
  if (typeof body.searchSynonyms === "string") patch.searchSynonyms = body.searchSynonyms.slice(0, 8000);
  if (body.branchCutoffs && typeof body.branchCutoffs === "object") {
    const bc: Record<string, number> = {};
    for (const [k, v] of Object.entries(body.branchCutoffs as Record<string, unknown>)) {
      if (Number.isFinite(Number(v))) bc[k] = Math.max(0, Math.min(23, Math.round(Number(v))));
    }
    patch.branchCutoffs = bc;
  }
  if (body.modelLook && typeof body.modelLook === "object") {
    const ml = body.modelLook as { enabled?: unknown; items?: unknown };
    const items = (Array.isArray(ml.items) ? ml.items : [])
      .slice(0, 8)
      .map((raw) => {
        const o = (raw || {}) as Record<string, unknown>;
        const clamp = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
        return {
          handle: String(o.handle ?? "").trim().slice(0, 120),
          label: String(o.label ?? "").trim().slice(0, 40),
          hoofdgroep: String(o.hoofdgroep ?? "").trim().slice(0, 60),
          x: clamp(o.x),
          y: clamp(o.y),
        };
      })
      .filter((it) => it.handle);
    patch.modelLook = {
      enabled: ml.enabled !== false,
      minStock: Math.max(0, Math.round(Number((ml as { minStock?: unknown }).minStock) || 8)),
      items,
    };
  }

  const next = await updateSettings(patch);
  return NextResponse.json({ ok: true, settings: next });
}
