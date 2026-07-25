import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { listRedirects, upsertRedirect, deleteRedirect, setRedirectActive } from "@/lib/redirects-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Redirects beheren vanuit de Site-studio (/account/redirects) — alleen voor
 * beheerders die in de winkel zelf ingelogd zijn. De portal gebruikt hiervoor
 * app/api/studio/site/redirects (token); deze route is de eigen-account-kant.
 *
 * GET                                                  → lijst
 * POST { source, target, status?, active?, originalSource? } → toevoegen/bijwerken
 * POST { action:"delete", source }                     → verwijderen
 * POST { action:"toggle", source, active }             → aan/uit
 */
async function guard() {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "Niet ingelogd." }, { status: 401 });
  if (!customer.isAdmin) return NextResponse.json({ ok: false, error: "Geen beheerrechten." }, { status: 403 });
  return null;
}

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  return NextResponse.json({ ok: true, redirects: await listRedirects() });
}

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  let body: {
    action?: unknown;
    source?: unknown;
    target?: unknown;
    status?: unknown;
    active?: unknown;
    originalSource?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const source = String(body.source ?? "");
  if (!source.trim()) return NextResponse.json({ ok: false, error: "Bron-pad ontbreekt." }, { status: 400 });

  try {
    if (body.action === "delete") {
      return NextResponse.json({ ok: true, redirects: await deleteRedirect(source) });
    }
    if (body.action === "toggle") {
      return NextResponse.json({ ok: true, redirects: await setRedirectActive(source, Boolean(body.active)) });
    }
    const redirects = await upsertRedirect({
      source,
      target: String(body.target ?? ""),
      status: Number(body.status),
      active: body.active === undefined ? true : Boolean(body.active),
      originalSource: body.originalSource ? String(body.originalSource) : undefined,
      // Zonder originalSource komt dit uit de knop "Nieuwe redirect"; dan mag een
      // bestaande regel op dezelfde bron niet zomaar overschreven worden.
      mode: body.originalSource ? "upsert" : "create",
    });
    return NextResponse.json({ ok: true, redirects });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Opslaan mislukte." }, { status: 400 });
  }
}
