import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { saveLook, deleteStoredLook, getManagedLooks, type StoredLook } from "@/lib/looks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Looks opslaan/verwijderen vanuit de Site-studio (/account/looks).
 * Alleen met het recht "content" — de portal gebruikt zijn eigen
 * token-endpoint onder /api/studio. De opslag zelf zit in lib/looks.
 *
 * POST { action:"save", look, create? } → opslaan/publiceren (status in de look);
 *                                         create:true = nieuwe look, bestaande slug weigeren
 *      { action:"delete", slug }        → uit de store halen (standaard-look blijft)
 */
function sanitizeLook(input: unknown): StoredLook | null {
  const b = (input || {}) as Record<string, unknown>;
  const slug = String(b.slug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return null;

  const hotspots = (Array.isArray(b.hotspots) ? (b.hotspots as Record<string, unknown>[]) : [])
    .map((h) => ({
      handle: String(h.handle || "").trim(),
      label: String(h.label || "").trim() || undefined,
      x: Math.max(0, Math.min(100, Math.round(Number(h.x) || 50))),
      y: Math.max(0, Math.min(100, Math.round(Number(h.y) || 50))),
    }))
    .filter((h) => h.handle)
    .slice(0, 12);

  // images[] is de bron van waarheid ([0] = hoofdfoto); image blijft als compat-veld.
  const images = (Array.isArray(b.images) ? (b.images as unknown[]) : [])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 12);

  return {
    slug,
    title: String(b.title || "").trim().slice(0, 120) || slug,
    subtitle: String(b.subtitle || "").trim().slice(0, 240),
    occasion: String(b.occasion || "").trim().slice(0, 80),
    theme: b.theme ? String(b.theme).trim().slice(0, 80) || undefined : undefined,
    image: (images[0] || String(b.image || "").trim()).slice(0, 600),
    images: images.length ? images : undefined,
    story: b.story ? String(b.story).slice(0, 4000) : undefined,
    hotspots,
    status: b.status === "published" ? "published" : "draft",
  };
}

export async function POST(req: Request) {
  if (!(await requirePermission("content"))) {
    return NextResponse.json({ ok: false, error: "Geen toegang: hiervoor heb je het werkgebied Content nodig." }, { status: 403 });
  }

  let body: { action?: unknown; look?: unknown; slug?: unknown; create?: unknown };
  try {
    body = (await req.json()) as { action?: unknown; look?: unknown; slug?: unknown; create?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const action = String(body.action || "save");
  try {
    if (action === "delete") {
      const slug = String(body.slug || "").trim().toLowerCase();
      if (!slug) return NextResponse.json({ ok: false, error: "Geen slug opgegeven." }, { status: 400 });
      await deleteStoredLook(slug);
      return NextResponse.json({ ok: true });
    }
    const look = sanitizeLook(body.look);
    if (!look) return NextResponse.json({ ok: false, error: "Ongeldige look — een slug is verplicht." }, { status: 400 });
    // saveLook is een blinde upsert op slug: zonder deze controle overschrijft een
    // "Nieuwe look" met een bestaande slug die look zonder enige waarschuwing.
    if (body.create === true && (await getManagedLooks()).some((l) => l.slug === look.slug)) {
      return NextResponse.json(
        { ok: false, error: `Er bestaat al een look met de slug "${look.slug}". Kies een andere slug of bewerk de bestaande look.` },
        { status: 409 },
      );
    }
    await saveLook(look);
    return NextResponse.json({ ok: true, look });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
