import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getStorePages, saveStorePages, type StorePage } from "@/lib/content-pages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Content-pagina-beheer voor het portal ("Nieuwe site" → Pagina's).
 *   GET  → de huidige content-pagina's (content:pages).
 *   POST { items } → opslaan (gesaneerd, lichte Markdown-body). Vervangt Sanity-pages.
 * Auth: admin OF STUDIO_API_TOKEN.
 */
const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const slugify = (v: unknown) => s(v, 80).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");

function sanitize(input: unknown): StorePage[] {
  const items = Array.isArray(input) ? input : [];
  const now = new Date().toISOString();
  const seen = new Set<string>();
  return items
    .map((raw) => {
      const o = (raw || {}) as Record<string, unknown>;
      const slug = slugify(o.slug) || slugify(o.title);
      return {
        slug,
        title: s(o.title, 120),
        body: s(o.body, 40000),
        seoDescription: o.seoDescription ? s(o.seoDescription, 200) : undefined,
        image: o.image ? s(o.image, 600) : undefined,
        updatedAt: now,
      };
    })
    .filter((p) => {
      if (!p.slug || !p.title || seen.has(p.slug)) return false;
      seen.add(p.slug);
      return true;
    });
}

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, items: await getStorePages() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  let body: { items?: unknown };
  try {
    body = (await req.json()) as { items?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  if (!Array.isArray(body?.items)) return NextResponse.json({ ok: false, error: "Ongeldige lijst." }, { status: 400 });
  const items = sanitize(body.items);
  try {
    await saveStorePages(items);
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
