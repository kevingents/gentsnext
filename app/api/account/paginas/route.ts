import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { getStorePages, saveStorePages, type StorePage } from "@/lib/content-pages";
import { reservedPageSlugs } from "@/lib/reserved-page-slugs";
import { CONFLICT_MESSAGE, docVersion } from "@/lib/content-version";
import { IMAGE_HINT, isSafeImageSrc } from "@/lib/safe-image";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Content-pagina's vanuit de Site-studio in de webshop zelf (/account/paginas).
 *   GET  → huidige pagina's + versiestempel.
 *   POST { items, version } → de complete lijst opslaan (gesaneerd). Weglaten = verwijderen.
 * Auth: ingelogde medewerker met het recht "content". Bewust NIET de studio-token-route — die is
 * voor de portal.
 */
const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const slugify = (v: unknown) =>
  s(v, 80).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * `prev` = wat er nu is opgeslagen. Nodig om de datum "bijgewerkt" alleen te
 * verzetten bij een pagina die ECHT veranderd is; anders zou één opslag alle
 * pagina's op vandaag zetten en is de datum in de lijst niets meer waard.
 */
function sanitize(input: unknown, prev: StorePage[]): StorePage[] {
  const items = Array.isArray(input) ? input : [];
  const now = new Date().toISOString();
  const before = new Map(prev.map((p) => [p.slug, p]));
  const seen = new Set<string>();
  return items
    .map((raw) => {
      const o = (raw || {}) as Record<string, unknown>;
      const slug = slugify(o.slug) || slugify(o.title);
      const next: StorePage = {
        slug,
        title: s(o.title, 120),
        body: s(o.body, 40000),
        seoDescription: o.seoDescription ? s(o.seoDescription, 200) : undefined,
        image: o.image ? s(o.image, 600) : undefined,
        updatedAt: now,
      };
      const old = before.get(slug);
      const unchanged =
        old &&
        old.title === next.title &&
        old.body === next.body &&
        (old.seoDescription || undefined) === next.seoDescription &&
        (old.image || undefined) === next.image;
      if (unchanged && old.updatedAt) next.updatedAt = old.updatedAt;
      return next;
    })
    .filter((p) => {
      if (!p.slug || !p.title || seen.has(p.slug)) return false;
      seen.add(p.slug);
      return true;
    });
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
    const items = await getStorePages();
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
  if (!Array.isArray(body?.items)) {
    return NextResponse.json({ ok: false, error: "Ongeldige lijst." }, { status: 400 });
  }

  let current: StorePage[];
  try {
    current = await getStorePages();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  // Botsingscontrole: de studio stuurt de versie mee die zij bij het openen las.
  // Wijkt die af, dan heeft de portal (of een tweede tabblad) intussen
  // geschreven en zou deze opslag dat wissen.
  const version = typeof body.version === "string" ? body.version : "";
  const live = docVersion(current);
  if (version && version !== live) {
    return NextResponse.json({ ok: false, error: CONFLICT_MESSAGE, version: live }, { status: 409 });
  }

  const items = sanitize(body.items, current);
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
  // Een beeld dat next/image niet aankan zet de PUBLIEKE pagina op 500 — dus
  // hier weigeren in plaats van het stil te bewaren.
  const badImages = items.filter((p) => !isSafeImageSrc(p.image || "")).map((p) => p.slug);
  if (badImages.length) {
    return NextResponse.json(
      { ok: false, error: `Afbeelding klopt niet bij: ${badImages.join(", ")}. ${IMAGE_HINT}` },
      { status: 400 },
    );
  }

  try {
    await saveStorePages(items);
    return NextResponse.json({ ok: true, items, version: docVersion(items) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
