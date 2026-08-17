import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { slaProductOp, PIM_VELDEN, PIM_LAGEN, pimCheckLabels, type PimPatch } from "@/lib/pim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Bewerken van één artikel vanuit het PIM (portal → /site/producten/<handle>).
 *
 * GET  → de velddefinities: welke velden bestaan, wat mag erin, wat meet de
 *        compleetheidsscore. De portal bouwt zijn formulier hieruit op, zodat
 *        een nieuw veld niet op twee plekken bijgewerkt hoeft te worden.
 * POST { handle, velden?, metavelden?, lagen?, slot?, actor? } → opslaan.
 *
 * Bewerken vergrendelt automatisch: zie lib/pim.ts. Auth: gentsnext-admin OF
 * STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  return NextResponse.json({
    ok: true,
    velden: PIM_VELDEN.map(({ sleutel, label, type, opties, maxLengte, uitleg, bulk }) => ({
      sleutel,
      label,
      type,
      opties: opties ?? null,
      maxLengte,
      uitleg,
      bulk,
    })),
    lagen: PIM_LAGEN.map((l) => ({ ...l })),
    checks: pimCheckLabels(),
  });
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const handle = String(body.handle || "").trim();
  if (!handle) return NextResponse.json({ ok: false, error: "handle vereist." }, { status: 400 });

  /* De actor komt van de portal-BFF, die weet wie er ingelogd is. Rechtstreeks
     met de token aanroepen mag ook — dan blijft het logboek leeg op dat veld,
     wat eerlijker is dan een verzonnen naam. */
  const actor = String(body.actor || "").trim();

  const patch: PimPatch = {
    velden: tekstMap(body.velden),
    metavelden: tekstMap(body.metavelden),
    lagen: tekstMap(body.lagen) as PimPatch["lagen"],
    slot: boolMap(body.slot),
  };
  if (!patch.velden && !patch.metavelden && !patch.lagen && !patch.slot) {
    return NextResponse.json({ ok: false, error: "Niets om op te slaan." }, { status: 400 });
  }

  try {
    const r = await slaProductOp(handle, patch, actor);
    if (!r.ok) return NextResponse.json(r, { status: r.error === "Product niet gevonden." ? 404 : 400 });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/** Alleen string-waarden overnemen; undefined als er niets bruikbaars in zat. */
function tekstMap(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const uit: Record<string, string> = {};
  for (const [k, w] of Object.entries(v as Record<string, unknown>)) {
    if (typeof w === "string" || typeof w === "number") uit[k] = String(w);
  }
  return Object.keys(uit).length ? uit : undefined;
}

function boolMap(v: unknown): Record<string, boolean> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const uit: Record<string, boolean> = {};
  for (const [k, w] of Object.entries(v as Record<string, unknown>)) {
    if (typeof w === "boolean") uit[k] = w;
  }
  return Object.keys(uit).length ? uit : undefined;
}
