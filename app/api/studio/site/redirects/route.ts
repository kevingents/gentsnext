import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
// Eén schrijfpad voor redirects: de Site-studio (/account/redirects) en dit
// portal-endpoint gebruiken dezelfde lib, zodat validatie en opslag niet uit
// elkaar kunnen lopen.
import { listRedirects, upsertRedirect, deleteRedirect } from "@/lib/redirects-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";




/**
 * Portal-beheerbare redirects (301/302). Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 * GET                                          → lijst
 * POST { source, target, status?, active? }    → toevoegen/bijwerken (op source)
 * POST { action:"delete", source }             → verwijderen
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  return NextResponse.json({ ok: true, redirects: await listRedirects() });
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { source?: unknown; target?: unknown; status?: unknown; active?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  try {
    // Zelfde schrijfpad als /account/redirects (lib/redirects-admin): validatie,
    // normalisatie en opslag staan op één plek, niet twee keer.
    if (body.action === "delete") {
      const redirects = await deleteRedirect(String(body.source || ""));
      return NextResponse.json({ ok: true, redirects });
    }
    const redirects = await upsertRedirect({
      source: String(body.source || ""),
      target: String(body.target || ""),
      status: Number(body.status) === 302 ? 302 : 301,
      active: body.active === undefined ? true : Boolean(body.active),
    });
    return NextResponse.json({ ok: true, redirects });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Opslaan mislukt." }, { status: 400 });
  }
}
