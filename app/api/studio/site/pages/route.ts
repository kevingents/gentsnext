import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getStorePages, saveStorePages, type StorePage } from "@/lib/content-pages";
import { reservedPageSlugs } from "@/lib/reserved-page-slugs";
import { IMAGE_HINT, isSafeImageSrc } from "@/lib/safe-image";
import { docVersion, CONFLICT_MESSAGE } from "@/lib/content-version";

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
    const items = await getStorePages();
    return NextResponse.json({ ok: true, items, version: docVersion(items) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  let body: { items?: unknown; version?: unknown };
  try {
    body = (await req.json()) as { items?: unknown; version?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  if (!Array.isArray(body?.items)) return NextResponse.json({ ok: false, error: "Ongeldige lijst." }, { status: 400 });
  const items = sanitize(body.items);
  // Slugs met een vaste, in code afgehandelde pagina: een eigen pagina hierop zou
  // stilletjes overschaduwd worden. Zelfde lijst als /api/account/paginas —
  // reservedPageSlugs() kent naast de vaste landings óók alle winkelpagina's,
  // die in deze route eerder ontbraken.
  const blocked = new Set(reservedPageSlugs());
  const reserved = items.filter((p) => blocked.has(p.slug)).map((p) => p.slug);
  if (reserved.length) {
    return NextResponse.json(
      { ok: false, error: `Deze slug(s) zijn gereserveerd voor een vaste pagina en kunnen niet als content-pagina: ${reserved.join(", ")}. Kies een andere slug.` },
      { status: 400 },
    );
  }
  // Een beeld dat next/image niet aankan zet de PUBLIEKE pagina op 500 — hier
  // weigeren i.p.v. stil bewaren (gelijk aan /api/account/paginas; die divergentie
  // was de bug: de portal-schrijfkant miste deze controle).
  const badImages = items.filter((p) => !isSafeImageSrc(p.image || "")).map((p) => p.slug);
  if (badImages.length) {
    return NextResponse.json(
      { ok: false, error: `Afbeelding klopt niet bij: ${badImages.join(", ")}. ${IMAGE_HINT}` },
      { status: 400 },
    );
  }
  try {
    // Botsingscontrole: stuurt de client de stempel mee die hij bij het openen
    // kreeg, dan moet die nog kloppen met wat er nu staat. Zo niet, dan heeft
    // iemand anders intussen opgeslagen en zou dit zijn werk wissen.
    // Ontbreekt de stempel, dan slaan we gewoon op — anders zou een oudere
    // client tijdens een uitrol geen enkele wijziging meer kwijt kunnen.
    if (typeof body.version === "string" && body.version) {
      const huidig = docVersion(await getStorePages());
      if (body.version !== huidig) {
        return NextResponse.json({ ok: false, error: CONFLICT_MESSAGE, conflict: true }, { status: 409 });
      }
    }
    await saveStorePages(items);
    // Verse stempel uit de leeslaag, niet uit wat we net instuurden.
    return NextResponse.json({ ok: true, items, version: docVersion(await getStorePages()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
