import { NextResponse } from "next/server";
import { generateBlogPost } from "@/lib/blog";
import { getSessionCustomer } from "@/lib/account";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Tweewekelijkse AI-stijlgids-cron (zie vercel.json: 1e + 15e van de maand).
 * Vercel-cron stuurt `Authorization: Bearer <CRON_SECRET>`. Een ingelogde admin
 * mag 'm ook handmatig starten. Genereert het volgende onderwerp uit BLOG_TOPICS.
 */
function secretOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${secret}` || new URL(req.url).searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  const ok = secretOk(req);
  if (!ok) {
    const customer = await getSessionCustomer().catch(() => null);
    if (!customer?.isAdmin) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY ontbreekt" }, { status: 412 });
  }
  try {
    const post = await generateBlogPost();
    if (!post) return NextResponse.json({ ok: false, error: "geen artikel gegenereerd" }, { status: 422 });
    return NextResponse.json({ ok: true, slug: post.slug, title: post.title });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
