import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getAllSeoOverrides, setSeoOverride, deleteSeoOverride } from "@/lib/seo-overrides";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Portal-beheerbare SEO-overrides. Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 * GET                                   → alle overrides
 * POST { path, title?, description?, noindex? }  → upsert
 * POST { action:"delete", path }        → verwijderen
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  return NextResponse.json({ ok: true, overrides: await getAllSeoOverrides() });
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { path?: unknown; title?: unknown; description?: unknown; noindex?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const path = String(body.path || "").trim();
  if (!path) return NextResponse.json({ ok: false, error: "Pad vereist (bv. /products/<handle>)." }, { status: 400 });

  try {
    if (body.action === "delete") {
      await deleteSeoOverride(path);
    } else {
      await setSeoOverride(path, {
        title: body.title !== undefined ? String(body.title) : undefined,
        description: body.description !== undefined ? String(body.description) : undefined,
        noindex: body.noindex !== undefined ? Boolean(body.noindex) : undefined,
      });
    }
    return NextResponse.json({ ok: true, overrides: await getAllSeoOverrides() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
