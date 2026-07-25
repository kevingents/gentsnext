import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { searchProducts } from "@/lib/catalog";
import { pinKey, type PinContextKind } from "@/lib/merchandising";
import {
  checkPinsInContext,
  recordPinsSince,
  resolvePinItems,
  savePinsForContext,
  type PinItem,
} from "@/lib/merchandising-admin";

export const dynamic = "force-dynamic";

/**
 * Site-studio → Uitgelicht. Beheert de merchandising-pins vanuit de webshop
 * zelf (dus zonder portal en zonder studio-token).
 *
 * GET  ?q=…&kind=…&slug=…      → producten zoeken om te pinnen, alleen die
 *                                daadwerkelijk op díe winkelpagina staan.
 * GET  ?handles=a,b&kind&slug  → controle: doen deze pins daar iets?
 * POST { kind, slug, handles[] } → de pins van één context (over)schrijven.
 *
 * Alleen met het recht "presentatie".
 */

const MAX_PINS = 24;

async function denyZonderRecht(): Promise<NextResponse | null> {
  if (!(await requirePermission("presentatie"))) {
    return NextResponse.json({ ok: false, error: "Geen toegang: hiervoor heb je het werkgebied Presentatie nodig." }, { status: 403 });
  }
  return null;
}

export async function GET(req: Request) {
  const denied = await denyZonderRecht();
  if (denied) return denied;

  const params = new URL(req.url).searchParams;
  const q = (params.get("q") || "").trim().slice(0, 80);
  const ctxKind: PinContextKind | null =
    params.get("kind") === "collection" ? "collection" : params.get("kind") === "categorie" ? "categorie" : null;
  const ctxSlug = (params.get("slug") || "").trim();
  const hasContext = Boolean(ctxKind && ctxSlug);

  // Controlemodus: doen deze (al gepinde) handles iets op deze winkelpagina?
  const toCheck = (params.get("handles") || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(0, MAX_PINS);
  if (toCheck.length) {
    if (!hasContext) return NextResponse.json({ ok: true, checks: [] });
    try {
      return NextResponse.json({ ok: true, checks: await checkPinsInContext(ctxKind!, ctxSlug, toCheck) });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }

  if (q.length < 2) return NextResponse.json({ ok: true, results: [] });
  try {
    // Ruimer zoeken en daarna filteren: een pin werkt alleen binnen de gekozen
    // categorie/collectie, dus resultaten daarbuiten aanbieden is misleidend.
    const found = await searchProducts(q, hasContext ? 48 : 12);
    let results: PinItem[] = found.map((p) => ({
      handle: p.handle,
      title: p.title,
      imageUrl: p.imageUrl,
      priceCents: p.minPriceCents,
      known: true,
    }));
    if (hasContext) {
      const checks = await checkPinsInContext(ctxKind!, ctxSlug, results.map((r) => r.handle));
      const ok = new Set(checks.filter((c) => c.ok).map((c) => c.handle));
      results = results.filter((r) => ok.has(r.handle)).slice(0, 12);
    }
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await denyZonderRecht();
  if (denied) return denied;

  let body: { kind?: unknown; slug?: unknown; handles?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const kind: PinContextKind | null =
    body.kind === "collection" ? "collection" : body.kind === "categorie" ? "categorie" : null;
  const slug = String(body.slug ?? "").trim();
  if (!kind || !slug) {
    return NextResponse.json({ ok: false, error: "Kies eerst een categorie of collectie." }, { status: 400 });
  }
  const handles = Array.isArray(body.handles)
    ? body.handles.map((h) => String(h ?? "").trim()).filter(Boolean).slice(0, MAX_PINS)
    : [];

  try {
    const key = pinKey(kind, slug);
    // Alleen deze pin-sleutel bijschrijven, niet de hele instellingen-rij vanuit
    // een cache — zie savePinsForContext.
    const saved = await savePinsForContext(key, handles);
    const [since, pinned] = await Promise.all([recordPinsSince(key, saved), resolvePinItems(saved)]);
    return NextResponse.json({ ok: true, key, handles: saved, since, pinned });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
