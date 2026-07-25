import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { setContentDoc } from "@/lib/content-store";
import type { Occasion } from "@/lib/occasions-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Gelegenheden opslaan vanuit de Site-studio (/account/gelegenheden).
 * Alleen voor ingelogde beheerders; de opslag zelf is de gedeelde content-store
 * (content:occasions), die de tegels op /gelegenheden voedt.
 */
const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const slugify = (v: unknown) => s(v, 80).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
/** Alleen veilige link-schemes toestaan — de tegels renderen op een publieke pagina. */
const safeHref = (v: unknown, n: number) => {
  const h = s(v, n);
  return /^(\/|https:\/\/|mailto:|tel:|#)/i.test(h) ? h : "#";
};

function sanitize(input: unknown): Occasion[] {
  return (Array.isArray(input) ? input : [])
    .map((raw) => {
      const o = (raw || {}) as Record<string, unknown>;
      return {
        slug: slugify(o.slug) || slugify(o.title),
        title: s(o.title, 80),
        eyebrow: s(o.eyebrow, 80),
        intro: s(o.intro, 600),
        image: s(o.image, 600),
        ctaLabel: s(o.ctaLabel, 60) || "Bekijk",
        ctaHref: safeHref(o.ctaHref, 200) || "#",
        links: (Array.isArray(o.links) ? o.links : [])
          .map((l) => {
            const lk = (l || {}) as Record<string, unknown>;
            return { label: s(lk.label, 60), href: safeHref(lk.href, 200) };
          })
          .filter((l) => l.label && l.href)
          .slice(0, 8),
      };
    })
    .filter((o) => o.slug && o.title)
    .slice(0, 24);
}

export async function POST(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "Niet ingelogd." }, { status: 401 });
  if (!customer.isAdmin) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let body: { items?: unknown };
  try {
    body = (await req.json()) as { items?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const items = sanitize(body?.items);
  if (!items.length) {
    return NextResponse.json({ ok: false, error: "Minimaal één gelegenheid met titel is vereist." }, { status: 400 });
  }
  // Dubbele slugs zouden twee tegels naar dezelfde pagina laten wijzen.
  const slugs = new Set(items.map((o) => o.slug));
  if (slugs.size !== items.length) {
    return NextResponse.json({ ok: false, error: "Twee gelegenheden hebben dezelfde slug." }, { status: 400 });
  }

  try {
    await setContentDoc("occasions", { items });
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
