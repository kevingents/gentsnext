import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { searchProducts } from "@/lib/catalog";
import { setMerchandisingPins, pinKey, type PinContextKind } from "@/lib/merchandising";
import { recordPinsSince, resolvePinItems, type PinItem } from "@/lib/merchandising-admin";

export const dynamic = "force-dynamic";

/**
 * Site-studio → Uitgelicht. Beheert de merchandising-pins vanuit de webshop
 * zelf (dus zonder portal en zonder studio-token).
 *
 * GET  ?q=…  → producten zoeken om te pinnen.
 * POST { kind, slug, handles[] } → de pins van één context (over)schrijven.
 *
 * Alleen voor ingelogde beheerders.
 */

const MAX_PINS = 24;

async function denyIfNotAdmin(): Promise<NextResponse | null> {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "Niet ingelogd." }, { status: 401 });
  if (!customer.isAdmin) return NextResponse.json({ ok: false, error: "Geen beheerrechten." }, { status: 403 });
  return null;
}

export async function GET(req: Request) {
  const denied = await denyIfNotAdmin();
  if (denied) return denied;

  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ ok: true, results: [] });
  try {
    const found = await searchProducts(q, 12);
    const results: PinItem[] = found.map((p) => ({
      handle: p.handle,
      title: p.title,
      imageUrl: p.imageUrl,
      priceCents: p.minPriceCents,
      known: true,
    }));
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await denyIfNotAdmin();
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
    const saved = await setMerchandisingPins(kind, slug, handles);
    const [since, pinned] = await Promise.all([recordPinsSince(key, saved), resolvePinItems(saved)]);
    return NextResponse.json({ ok: true, key, handles: saved, since, pinned });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
