import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getMenu } from "@/lib/menu-server";
import { setContentDoc } from "@/lib/content-store";
import type { MenuItem } from "@/lib/main-menu";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Hoofdmenu-beheer voor het portal ("Nieuwe site" → Menu).
 *   GET  → het huidige menu (eigen store of MAIN_MENU-seed).
 *   POST { items } → opslaan in content:menu (gesaneerd). Vervangt Sanity.
 * Auth: admin OF STUDIO_API_TOKEN.
 */
const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
/** Alleen veilige link-schemes toestaan (stored-XSS-preventie op de publieke site). */
const safeHref = (v: unknown, n: number) => { const h = s(v, n); return /^(\/|https:\/\/|mailto:|tel:|#)/i.test(h) ? h : "#"; };

function sanitize(input: unknown): MenuItem[] {
  const items = Array.isArray(input) ? input : [];
  return items
    .map((raw) => {
      const i = (raw || {}) as Record<string, unknown>;
      const columns = (Array.isArray(i.columns) ? i.columns : [])
        .map((c) => {
          const col = (c || {}) as Record<string, unknown>;
          const links = (Array.isArray(col.links) ? col.links : [])
            .map((l) => {
              const lk = (l || {}) as Record<string, unknown>;
              return { label: s(lk.label, 60), href: safeHref(lk.href, 200) };
            })
            .filter((l) => l.label && l.href);
          return { title: col.title ? s(col.title, 60) : undefined, links };
        })
        .filter((c) => c.links.length);
      const features = (Array.isArray(i.features) ? i.features : [])
        .map((f) => {
          const ft = (f || {}) as Record<string, unknown>;
          return { label: s(ft.label, 60), caption: ft.caption ? s(ft.caption, 120) : undefined, href: safeHref(ft.href, 200), image: s(ft.image, 600) };
        })
        .filter((f) => f.href && f.image);
      return {
        label: s(i.label, 60),
        href: safeHref(i.href, 200) || "#",
        ...(columns.length ? { columns } : {}),
        ...(features.length ? { features } : {}),
      };
    })
    .filter((i) => i.label);
}

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, items: await getMenu() });
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
  if (!items.length) return NextResponse.json({ ok: false, error: "Het menu mag niet leeg zijn." }, { status: 400 });
  try {
    await setContentDoc("menu", { items });
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
