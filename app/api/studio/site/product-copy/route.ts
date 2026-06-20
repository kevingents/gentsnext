import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getProductByHandle } from "@/lib/catalog";
import {
  getProductContentOverride,
  setProductContentOverride,
  generateProductCopy,
} from "@/lib/product-content";
import { getSeoOverride, setSeoOverride } from "@/lib/seo-overrides";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * AI-productcontent (portal). Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 * GET  ?handle           → huidige basis + override + SEO
 * POST { handle, action:"generate" } → AI-concept (slaat niets op)
 * POST { handle, action:"save", descriptionHtml, seoTitle, seoDescription } → opslaan
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const handle = (new URL(req.url).searchParams.get("handle") || "").trim();
  if (!handle) return NextResponse.json({ ok: false, error: "handle vereist." }, { status: 400 });

  const data = await getProductByHandle(handle);
  if (!data) return NextResponse.json({ ok: false, error: "Product niet gevonden." }, { status: 404 });

  const [override, seo] = await Promise.all([
    getProductContentOverride(handle),
    getSeoOverride(`/products/${handle}`),
  ]);
  return NextResponse.json({
    ok: true,
    handle,
    title: data.product.title,
    base: { descriptionHtml: data.product.descriptionHtml || "" },
    override: { descriptionHtml: override?.descriptionHtml || "" },
    seo: { title: seo?.title || "", description: seo?.description || "" },
  });
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { handle?: unknown; action?: unknown; descriptionHtml?: unknown; seoTitle?: unknown; seoDescription?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const handle = String(body.handle || "").trim();
  const action = String(body.action || "").trim();
  if (!handle) return NextResponse.json({ ok: false, error: "handle vereist." }, { status: 400 });

  try {
    if (action === "generate") {
      const draft = await generateProductCopy(handle);
      if (!draft) {
        return NextResponse.json({ ok: false, error: "AI niet beschikbaar (ANTHROPIC_API_KEY) of product onbekend." }, { status: 422 });
      }
      return NextResponse.json({ ok: true, draft });
    }
    if (action === "save") {
      await setProductContentOverride(handle, { descriptionHtml: String(body.descriptionHtml ?? "") });
      await setSeoOverride(`/products/${handle}`, {
        title: body.seoTitle !== undefined ? String(body.seoTitle) : undefined,
        description: body.seoDescription !== undefined ? String(body.seoDescription) : undefined,
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "Onbekende actie." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
