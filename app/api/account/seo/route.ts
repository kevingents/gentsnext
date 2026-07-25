import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { getAllSeoOverrides, setSeoOverride, deleteSeoOverride, hasSeoOverride } from "@/lib/seo-overrides";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SEO-overrides beheren vanuit de Site-studio (/account/seo) — alleen met het
 * recht "vindbaarheid", ingelogd in de winkel zelf. De portal gebruikt hiervoor
 * app/api/studio/site/seo (token); deze route is de eigen-account-kant.
 *
 * POST { path, title?, description?, noindex?, originalPath? } → toevoegen/bijwerken
 * POST { action:"delete", path }                               → verwijderen
 *
 * De schrijflogica zelf zit in lib/seo-overrides (setSeoOverride knipt de titel
 * op 200 en de omschrijving op 320 tekens en ruimt lege regels op).
 */
async function guard() {
  if (!(await requirePermission("vindbaarheid"))) {
    return NextResponse.json({ ok: false, error: "Geen toegang: hiervoor heb je het werkgebied Vindbaarheid nodig." }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  return NextResponse.json({ ok: true, overrides: await getAllSeoOverrides() });
}

const norm = (p: string) => "/" + String(p || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  let body: { action?: unknown; path?: unknown; title?: unknown; description?: unknown; noindex?: unknown; originalPath?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const path = norm(String(body.path ?? ""));
  if (!path || path === "/") {
    return NextResponse.json(
      { ok: false, error: "Vul een pad in, bijvoorbeeld /products/<handle> of /categorie/<slug>. De homepage kan hier niet." },
      { status: 400 },
    );
  }

  try {
    if (body.action === "delete") {
      await deleteSeoOverride(path);
      return NextResponse.json({ ok: true, overrides: await getAllSeoOverrides() });
    }

    const title = String(body.title ?? "").trim();
    const description = String(body.description ?? "").trim();
    const noindex = Boolean(body.noindex);
    if (!title && !description && !noindex) {
      return NextResponse.json(
        { ok: false, error: "Vul minstens een titel, een omschrijving of noindex in — anders valt er niets te overschrijven." },
        { status: 400 },
      );
    }

    // Hernoemen van het pad: eerst het nieuwe zetten, dan het oude opruimen.
    // Weigeren als het nieuwe pad al een regel heeft — anders overschrijft het
    // hernoemen die titel/omschrijving/noindex zonder dat iemand het ziet
    // (zelfde regel als upsertRedirect in lib/redirects-admin).
    const original = body.originalPath ? norm(String(body.originalPath)) : "";
    const renaming = Boolean(original) && original !== "/" && original !== path;
    if (renaming && (await hasSeoOverride(path))) {
      return NextResponse.json(
        { ok: false, error: `Er bestaat al een SEO-regel voor ${path}. Werk die regel bij of kies een ander pad.` },
        { status: 400 },
      );
    }
    await setSeoOverride(path, { title, description, noindex });
    if (renaming) await deleteSeoOverride(original);

    return NextResponse.json({ ok: true, overrides: await getAllSeoOverrides() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Opslaan mislukte." }, { status: 500 });
  }
}
