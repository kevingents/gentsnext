import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { bulkBewerk, type PimBulkActie } from "@/lib/pim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* Bulk loopt bewust per artikel (zie lib/pim.ts) — 500 artikelen × een paar
   queries past niet in de standaard 15 seconden. */
export const maxDuration = 300;

/**
 * Dezelfde bewerking op meerdere artikelen, vanuit de selectie in de
 * productenlijst.
 *
 * POST { handles: string[], actie: {...}, actor? }
 *   actie = { soort:"veld", sleutel:"status", waarde:"draft" }
 *         | { soort:"metaveld", sleutel:"pasvorm", waarde:"slim fit" }
 *         | { soort:"ontgrendel", sleutel:"status" }
 *
 * Geeft altijd 200 met een telling: bij 200 artikelen is "3 mislukt, 197
 * gelukt" bruikbare informatie en een 500 niet. Auth: gentsnext-admin OF
 * STUDIO_API_TOKEN.
 */
export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { handles?: unknown; actie?: unknown; actor?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const handles = Array.isArray(body.handles) ? body.handles.map((h) => String(h || "")) : [];
  const actie = leesActie(body.actie);
  if (!actie) return NextResponse.json({ ok: false, error: "Onbekende bulk-actie." }, { status: 400 });

  try {
    const r = await bulkBewerk(handles, actie, String(body.actor || "").trim());
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

function leesActie(v: unknown): PimBulkActie | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const soort = String(o.soort || "");
  const sleutel = String(o.sleutel || "").trim();
  if (!sleutel) return null;
  if (soort === "veld" || soort === "metaveld") {
    return { soort, sleutel, waarde: String(o.waarde ?? "") };
  }
  if (soort === "ontgrendel") return { soort, sleutel };
  return null;
}
