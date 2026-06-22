import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getBlogPosts, generateBlogPost, deleteBlogPost, BLOG_TOPICS } from "@/lib/blog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * AI-stijlgids beheer (portal). Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 * GET                          → alle artikelen + onderwerpen
 * POST { topicKey? }           → genereer een artikel (gegeven of volgend onderwerp)
 * POST { action:"delete", slug } → verwijderen
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  const posts = await getBlogPosts();
  return NextResponse.json({
    ok: true,
    topics: BLOG_TOPICS.map((t) => ({ key: t.key, title: t.title })),
    posts: posts.map((p) => ({ slug: p.slug, title: p.title, topicKey: p.topicKey, excerpt: p.excerpt, heroImage: p.heroImage, occasion: p.occasion, productCount: p.productHandles.length, publishedAt: p.publishedAt })),
  });
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  let body: { topicKey?: unknown; action?: unknown; slug?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  try {
    if (body.action === "delete") {
      const slug = String(body.slug || "").trim();
      if (!slug) return NextResponse.json({ ok: false, error: "slug vereist." }, { status: 400 });
      await deleteBlogPost(slug);
      return NextResponse.json({ ok: true });
    }
    const post = await generateBlogPost(body.topicKey ? String(body.topicKey) : undefined);
    if (!post) return NextResponse.json({ ok: false, error: "Genereren mislukt (ANTHROPIC_API_KEY of te weinig producten?)." }, { status: 422 });
    return NextResponse.json({ ok: true, slug: post.slug, title: post.title });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
