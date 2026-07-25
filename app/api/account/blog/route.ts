import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { generateBlogPost, deleteBlogPost, type BlogSection } from "@/lib/blog";
import { updateBlogPost } from "@/lib/blog-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Claude schrijft een compleet artikel; dat duurt langer dan de standaard-limiet.
export const maxDuration = 120;

/**
 * Stijlgids-beheer vanuit de Site-studio (/account/blog). Alleen voor ingelogde
 * beheerders; de portal heeft zijn eigen token-endpoint onder /api/studio.
 *
 * POST { action:"generate", topicKey? } → nieuw artikel laten schrijven
 *      { action:"update", slug, ... }   → titel/intro/secties bijwerken
 *      { action:"delete", slug }        → artikel verwijderen
 */
function sanitizeSections(input: unknown): BlogSection[] {
  return (Array.isArray(input) ? (input as Record<string, unknown>[]) : [])
    .map((s) => ({
      heading: String(s.heading || "").trim().slice(0, 120),
      body: String(s.body || "").trim().slice(0, 2000),
      productHandles: (Array.isArray(s.productHandles) ? (s.productHandles as unknown[]) : [])
        .map((h) => String(h).trim())
        .filter(Boolean)
        .slice(0, 8),
    }))
    .filter((s) => s.heading && s.body)
    .slice(0, 12);
}

export async function POST(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "Niet ingelogd." }, { status: 401 });
  if (!customer.isAdmin) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const action = String(body.action || "generate");
  const slug = String(body.slug || "").trim();

  try {
    if (action === "delete") {
      if (!slug) return NextResponse.json({ ok: false, error: "Geen artikel opgegeven." }, { status: 400 });
      await deleteBlogPost(slug);
      return NextResponse.json({ ok: true });
    }

    if (action === "update") {
      if (!slug) return NextResponse.json({ ok: false, error: "Geen artikel opgegeven." }, { status: 400 });
      const post = await updateBlogPost(slug, {
        title: String(body.title || "").trim().slice(0, 160),
        excerpt: String(body.excerpt || "").trim().slice(0, 240),
        intro: String(body.intro || "").trim().slice(0, 2000),
        sections: sanitizeSections(body.sections),
        seoTitle: String(body.seoTitle || "").trim().slice(0, 200),
        seoDescription: String(body.seoDescription || "").trim().slice(0, 320),
      });
      if (!post) return NextResponse.json({ ok: false, error: "Artikel niet gevonden." }, { status: 404 });
      return NextResponse.json({ ok: true, slug: post.slug });
    }

    // Genereren vereist een AI-sleutel; zonder sleutel geeft lib/blog netjes null
    // terug — dat vertalen we hier naar een begrijpelijke melding in de UI.
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { ok: false, error: "Genereren kan niet: er is geen AI-sleutel (ANTHROPIC_API_KEY) ingesteld." },
        { status: 422 },
      );
    }
    const topicKey = body.topicKey ? String(body.topicKey).trim() : undefined;
    const post = await generateBlogPost(topicKey || undefined);
    if (!post) {
      return NextResponse.json(
        { ok: false, error: "Genereren mislukt — te weinig producten op voorraad voor dit onderwerp, of de AI gaf geen bruikbaar antwoord." },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: true, slug: post.slug, title: post.title });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
