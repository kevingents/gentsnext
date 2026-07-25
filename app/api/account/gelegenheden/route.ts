import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { setContentDoc } from "@/lib/content-store";
import { getOccasions, type Occasion } from "@/lib/occasions-server";
import { CONFLICT_MESSAGE, docVersion } from "@/lib/content-version";
import { IMAGE_HINT, isSafeImageSrc } from "@/lib/safe-image";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Gelegenheden opslaan vanuit de Site-studio (/account/gelegenheden).
 * Alleen met het recht "content"; de opslag zelf is de gedeelde content-store
 * (content:occasions), die de tegels op /gelegenheden voedt.
 *   GET  → huidige tegels + versiestempel.
 *   POST { items, version } → de complete lijst opslaan (gesaneerd).
 */
const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const slugify = (v: unknown) => s(v, 80).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
/** Alleen veilige link-schemes toestaan — de tegels renderen op een publieke pagina. */
const safeHref = (v: unknown, n: number) => {
  const h = s(v, n);
  return /^(\/|https:\/\/|mailto:|tel:|#)/i.test(h) ? h : "#";
};

/**
 * Grenzen. Bewust GEEN stille .slice(): wie via het portal meer tegels of links
 * had aangemaakt, zou ze bij de eerste opslag vanuit de studio kwijtraken zonder
 * ook maar een melding. Overschrijding is dus een nette 400.
 */
const MAX_ITEMS = 24;
const MAX_LINKS = 8;

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
          .filter((l) => l.label && l.href),
      };
    })
    .filter((o) => o.slug && o.title);
}

async function guard() {
  if (!(await requirePermission("content"))) {
    return NextResponse.json({ ok: false, error: "Geen toegang: hiervoor heb je het werkgebied Content nodig." }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  try {
    const items = await getOccasions();
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
    return NextResponse.json({ ok: false, error: "Minimaal één gelegenheid met titel is vereist." }, { status: 400 });
  }
  if (items.length > MAX_ITEMS) {
    return NextResponse.json(
      { ok: false, error: `Maximaal ${MAX_ITEMS} gelegenheden; er zijn er nu ${items.length}. Haal er eerst een paar weg.` },
      { status: 400 },
    );
  }
  const tooManyLinks = items.filter((o) => o.links.length > MAX_LINKS).map((o) => o.title || o.slug);
  if (tooManyLinks.length) {
    return NextResponse.json(
      { ok: false, error: `Maximaal ${MAX_LINKS} extra links per gelegenheid — te veel bij: ${tooManyLinks.join(", ")}.` },
      { status: 400 },
    );
  }
  // Dubbele slugs zouden twee tegels naar dezelfde pagina laten wijzen.
  const slugs = new Set(items.map((o) => o.slug));
  if (slugs.size !== items.length) {
    return NextResponse.json({ ok: false, error: "Twee gelegenheden hebben dezelfde slug." }, { status: 400 });
  }
  // De tegel rendert met next/image; een beeld dat die niet aankan zet
  // /gelegenheden op 500 in plaats van alleen die ene tegel scheef.
  const badImages = items.filter((o) => !isSafeImageSrc(o.image)).map((o) => o.title || o.slug);
  if (badImages.length) {
    return NextResponse.json(
      { ok: false, error: `Beeld klopt niet bij: ${badImages.join(", ")}. ${IMAGE_HINT}` },
      { status: 400 },
    );
  }

  let live: string;
  try {
    live = docVersion(await getOccasions());
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
  // Botsingscontrole: het portal-venster schrijft hetzelfde document.
  const version = typeof body.version === "string" ? body.version : "";
  if (version && version !== live) {
    return NextResponse.json({ ok: false, error: CONFLICT_MESSAGE, version: live }, { status: 409 });
  }

  try {
    await setContentDoc("occasions", { items });
    return NextResponse.json({ ok: true, items, version: docVersion(items) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
