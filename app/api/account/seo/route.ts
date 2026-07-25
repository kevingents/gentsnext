import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { getAllSeoOverrides, setSeoOverride, deleteSeoOverride } from "@/lib/seo-overrides";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SEO-overrides beheren vanuit de Site-studio (/account/seo) — alleen voor
 * beheerders die in de winkel zelf ingelogd zijn. De portal gebruikt hiervoor
 * app/api/studio/site/seo (token); deze route is de eigen-account-kant.
 *
 * POST { path, title?, description?, noindex?, originalPath? } → toevoegen/bijwerken
 * POST { action:"delete", path }                               → verwijderen
 *
 * De schrijflogica zelf zit in lib/seo-overrides (setSeoOverride knipt de titel
 * op 200 en de omschrijving op 320 tekens en ruimt lege regels op).
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
    const original = body.originalPath ? norm(String(body.originalPath)) : "";
    await setSeoOverride(path, { title, description, noindex });
    if (original && original !== "/" && original !== path) await deleteSeoOverride(original);

    return NextResponse.json({ ok: true, overrides: await getAllSeoOverrides() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Opslaan mislukte." }, { status: 500 });
  }
}
