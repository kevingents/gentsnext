import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { getStorePages, saveStorePages, type StorePage } from "@/lib/content-pages";
import { reservedPageSlugs } from "@/lib/reserved-page-slugs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Content-pagina's vanuit de Site-studio in de webshop zelf (/account/paginas).
 *   GET  → huidige pagina's.
 *   POST { items } → de complete lijst opslaan (gesaneerd). Weglaten = verwijderen.
 * Auth: ingelogde beheerder (sessie). Bewust NIET de studio-token-route — die is
 * voor de portal.
 */
const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const slugify = (v: unknown) =>
  s(v, 80).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");

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

async function guard() {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "Niet ingelogd." }, { status: 401 });
  if (!customer.isAdmin) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  return null;
}

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  try {
    return NextResponse.json({ ok: true, items: await getStorePages() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  let body: { items?: unknown };
  try {
    body = (await req.json()) as { items?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  if (!Array.isArray(body?.items)) {
    return NextResponse.json({ ok: false, error: "Ongeldige lijst." }, { status: 400 });
  }

  const items = sanitize(body.items);
  const reserved = new Set(reservedPageSlugs());
  const clashes = items.filter((p) => reserved.has(p.slug)).map((p) => p.slug);
  if (clashes.length) {
    return NextResponse.json(
      {
        ok: false,
        error: `Deze webadres(sen) zijn al bezet door een vaste pagina en zouden nooit getoond worden: ${clashes.join(", ")}. Kies een ander webadres.`,
      },
      { status: 400 },
    );
  }

  try {
    await saveStorePages(items);
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
