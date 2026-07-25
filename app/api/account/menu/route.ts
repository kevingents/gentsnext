import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { getMenu } from "@/lib/menu-server";
import { setContentDoc } from "@/lib/content-store";
import { CONFLICT_MESSAGE, docVersion } from "@/lib/content-version";
import { IMAGE_HINT, isSafeImageSrc } from "@/lib/safe-image";
import type { MenuItem } from "@/lib/main-menu";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Hoofdmenu vanuit de Site-studio in de webshop zelf (/account/menu).
 *   GET  → het huidige menu (eigen content-doc of de MAIN_MENU-seed) + versiestempel.
 *   POST { items, version } → het complete menu opslaan in content:menu (gesaneerd).
 * Auth: ingelogde beheerder (sessie). Bewust NIET de studio-token-route.
 */
const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
/** Alleen veilige link-schemes toestaan (stored-XSS-preventie op de publieke site). */
const safeHref = (v: unknown, n: number) => {
  const h = s(v, n);
  return /^(\/|https:\/\/|mailto:|tel:|#)/i.test(h) ? h : "#";
};

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
      // Sfeer-tegels (beeld in het mega-menu) worden in de studio niet bewerkt,
      // maar wel ongewijzigd meegestuurd — zodat opslaan ze nooit wist.
      const features = (Array.isArray(i.features) ? i.features : [])
        .map((f) => {
          const ft = (f || {}) as Record<string, unknown>;
          return {
            label: s(ft.label, 60),
            caption: ft.caption ? s(ft.caption, 120) : undefined,
            href: safeHref(ft.href, 200),
            image: s(ft.image, 600),
          };
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
    const items = await getMenu();
    return NextResponse.json({ ok: true, items, version: docVersion(items) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  let body: { items?: unknown; version?: unknown };
  try {
    body = (await req.json()) as { items?: unknown; version?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const items = sanitize(body?.items);
  if (!items.length) {
    return NextResponse.json({ ok: false, error: "Het menu mag niet leeg zijn." }, { status: 400 });
  }
  // Sfeer-tegels dragen een beeld dat next/image moet kunnen laden; een ander
  // adres laat de header op ELKE publieke pagina crashen.
  const badImages = items
    .flatMap((i) => (i.features || []).map((f) => ({ item: i.label, image: f.image, label: f.label })))
    .filter((f) => !isSafeImageSrc(f.image));
  if (badImages.length) {
    return NextResponse.json(
      {
        ok: false,
        error: `Beeld van sfeer-tegel(s) klopt niet: ${badImages.map((f) => `${f.item} → ${f.label || f.image}`).join(", ")}. ${IMAGE_HINT}`,
      },
      { status: 400 },
    );
  }

  let live: string;
  try {
    live = docVersion(await getMenu());
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
  // Botsingscontrole: het menu wordt óók vanuit het portal geschreven; zonder
  // deze check wist de laatste opslag stilzwijgend de wijziging van de ander.
  const version = typeof body.version === "string" ? body.version : "";
  if (version && version !== live) {
    return NextResponse.json({ ok: false, error: CONFLICT_MESSAGE, version: live }, { status: 409 });
  }

  try {
    await setContentDoc("menu", { items });
    return NextResponse.json({ ok: true, items, version: docVersion(items) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
