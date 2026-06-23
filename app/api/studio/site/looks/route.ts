import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getManagedLooks, saveLook, deleteStoredLook, getLookGallery, type StoredLook } from "@/lib/looks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Looks-beheer voor het portal ("Nieuwe site" → Looks).
 *   GET  → alle looks (statisch/Sanity als basis + eigen store eroverheen), incl.
 *          status (published/draft) en de gekoppelde producten (hotspots).
 *   POST { action:"save", look }     → opslaan/goedkeuren (status in de look)
 *        { action:"delete", slug }   → uit de store halen (basis blijft bestaan)
 * Auth: admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    const looks = await getManagedLooks();
    // Verrijk met siteImages = de daadwerkelijk getoonde galerij (zodat de editor
    // 1-op-1 matcht met de site; de beheerder kan ze overschrijven via images[]).
    const withImages = await Promise.all(
      looks.map(async (l) => {
        try {
          const { hero, gallery } = await getLookGallery(l);
          return { ...l, siteImages: [hero, ...gallery.map((g) => g.url)].filter(Boolean) };
        } catch {
          return { ...l, siteImages: [l.image].filter(Boolean) };
        }
      }),
    );
    return NextResponse.json({ ok: true, looks: withImages });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

function sanitizeLook(input: unknown): StoredLook | null {
  const b = (input || {}) as Record<string, unknown>;
  const slug = String(b.slug || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) return null;
  const hotspots = Array.isArray(b.hotspots)
    ? (b.hotspots as Record<string, unknown>[])
        .map((h) => ({
          handle: String(h.handle || "").trim(),
          label: String(h.label || "").trim() || undefined,
          x: Math.max(0, Math.min(100, Math.round(Number(h.x) || 50))),
          y: Math.max(0, Math.min(100, Math.round(Number(h.y) || 50))),
        }))
        .filter((h) => h.handle)
    : [];
  // Foto's: images[] is de bron-van-waarheid (ordered: [0]=hero). image = hero (compat).
  const images = Array.isArray(b.images)
    ? (b.images as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 12)
    : [];
  return {
    slug,
    title: String(b.title || "").trim().slice(0, 120) || slug,
    subtitle: String(b.subtitle || "").trim().slice(0, 240),
    occasion: String(b.occasion || "").trim().slice(0, 80),
    theme: b.theme ? String(b.theme).trim().slice(0, 80) : undefined,
    image: (images[0] || String(b.image || "").trim()).slice(0, 600),
    images: images.length ? images : undefined,
    story: b.story ? String(b.story).slice(0, 4000) : undefined,
    hotspots,
    status: b.status === "published" ? "published" : "draft",
  };
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { action?: string; look?: unknown; slug?: string };
  try {
    body = (await req.json()) as { action?: string; look?: unknown; slug?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const action = String(body.action || "save");
  try {
    if (action === "delete") {
      const slug = String(body.slug || "").trim();
      if (!slug) return NextResponse.json({ ok: false, error: "Geen slug." }, { status: 400 });
      await deleteStoredLook(slug);
      return NextResponse.json({ ok: true });
    }
    const look = sanitizeLook(body.look);
    if (!look) return NextResponse.json({ ok: false, error: "Ongeldige look (slug vereist)." }, { status: 400 });
    await saveLook(look);
    return NextResponse.json({ ok: true, look });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
