import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getOccasions, type Occasion } from "@/lib/occasions-server";
import { setContentDoc } from "@/lib/content-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Gelegenheden-beheer voor het portal ("Nieuwe site" → Gelegenheden).
 *   GET  → de huidige gelegenheden (eigen store of de seed).
 *   POST { items } → opslaan in content:occasions (gesaneerd). Vervangt Sanity.
 * Auth: admin OF STUDIO_API_TOKEN.
 */
const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const slugify = (v: unknown) => s(v, 80).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
/** Alleen veilige link-schemes toestaan (stored-XSS-preventie op de publieke pagina). */
const safeHref = (v: unknown, n: number) => { const h = s(v, n); return /^(\/|https:\/\/|mailto:|tel:|#)/i.test(h) ? h : "#"; };

function sanitize(input: unknown): Occasion[] {
  const items = Array.isArray(input) ? input : [];
  return items
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
          .filter((l) => l.label && l.href),
      };
    })
    .filter((o) => o.slug && o.title);
}

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, items: await getOccasions() });
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
  const items = sanitize(body?.items);
  if (!items.length) return NextResponse.json({ ok: false, error: "Minimaal één gelegenheid vereist." }, { status: 400 });
  try {
    await setContentDoc("occasions", { items });
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
