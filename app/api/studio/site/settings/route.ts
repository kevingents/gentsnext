import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getSettings, updateSettings, type Settings } from "@/lib/settings";
import { getSiteSettings, updateSiteSettings, type SiteSettingsPatch } from "@/lib/site-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Portal-"Nieuwe site"-CMS → Instellingen. Beheert de VEILIGE, operationele
 * knoppen (verzending, levertijd, cutoffs, cadeaubon) uit app_settings.global
 * én de homepage-content (announcement, hero, USP's) uit app_settings.site.
 *
 * NIET hier: go-live-schakelaars (Mollie live, SRS_PUSH, Resend, indexable) —
 * die blijven env/secret. Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 *
 * GET  → { ok, operational, content }
 * POST → body { operational?, content? } → opgeslagen + teruggegeven
 */

/** Alleen deze operationele velden mag de portal zetten (rest blijft ongemoeid). */
function sanitizeOperational(input: unknown): Partial<Settings> {
  const b = (input || {}) as Record<string, unknown>;
  const out: Partial<Settings> = {};
  const intFields: (keyof Settings)[] = [
    "freeShippingCents", "shippingCents", "expressSurchargeCents",
    "warehouseCutoffHour", "storeCutoffHour",
    "standardMinDays", "standardMaxDays",
    "warehouseTransitDays", "storeExtraDays", "expressTransitDays",
    "retailSafetyStock", "warehouseSafetyStock",
  ];
  for (const f of intFields) {
    if (b[f] !== undefined && Number.isFinite(Number(b[f]))) {
      (out as Record<string, number>)[f] = Math.max(0, Math.round(Number(b[f])));
    }
  }
  if (b.protectUnderstockedRetail !== undefined) {
    out.protectUnderstockedRetail = Boolean(b.protectUnderstockedRetail);
  }
  if (b.giftcardConfig && typeof b.giftcardConfig === "object") {
    const g = b.giftcardConfig as Record<string, unknown>;
    out.giftcardConfig = {
      enabled: Boolean(g.enabled),
      presetAmountsCents: Array.isArray(g.presetAmountsCents)
        ? g.presetAmountsCents.map((x) => Math.max(0, Math.round(Number(x) || 0))).filter((x) => x > 0)
        : [2500, 5000, 10000, 15000],
      minCents: Math.max(0, Math.round(Number(g.minCents) || 1000)),
      maxCents: Math.max(0, Math.round(Number(g.maxCents) || 50000)),
      validityMonths: Math.max(1, Math.round(Number(g.validityMonths) || 24)),
    };
  }
  return out;
}

/** Homepage-content: announcement, hero, usps, deliveryCutoffHour. */
function sanitizeContent(input: unknown): SiteSettingsPatch {
  const b = (input || {}) as Record<string, unknown>;
  const out: SiteSettingsPatch = {};
  if (b.announcement && typeof b.announcement === "object") {
    const a = b.announcement as Record<string, unknown>;
    out.announcement = {
      text: String(a.text || "").slice(0, 240),
      linkLabel: a.linkLabel ? String(a.linkLabel).slice(0, 60) : undefined,
      linkHref: a.linkHref ? String(a.linkHref).slice(0, 200) : undefined,
    };
  }
  if (b.hero && typeof b.hero === "object") {
    const h = b.hero as Record<string, unknown>;
    out.hero = {
      eyebrow: String(h.eyebrow || "").slice(0, 60),
      title: String(h.title || "").slice(0, 120),
      subtitle: h.subtitle ? String(h.subtitle).slice(0, 280) : undefined,
      videoUrl: h.videoUrl ? String(h.videoUrl).slice(0, 400) : undefined,
      videoUrlMobile: h.videoUrlMobile ? String(h.videoUrlMobile).slice(0, 400) : undefined,
      posterUrl: String(h.posterUrl || "").slice(0, 400),
      primary: {
        label: String((h.primary as Record<string, unknown>)?.label || "").slice(0, 40),
        href: String((h.primary as Record<string, unknown>)?.href || "").slice(0, 200),
      },
      secondary: (h.secondary as Record<string, unknown>)?.label
        ? {
            label: String((h.secondary as Record<string, unknown>).label).slice(0, 40),
            href: String((h.secondary as Record<string, unknown>).href || "").slice(0, 200),
          }
        : undefined,
    };
  }
  if (Array.isArray(b.usps)) {
    out.usps = b.usps.map((x) => String(x).slice(0, 80)).filter(Boolean).slice(0, 8);
  }
  if (b.deliveryCutoffHour !== undefined && Number.isFinite(Number(b.deliveryCutoffHour))) {
    out.deliveryCutoffHour = Math.max(0, Math.min(23, Math.round(Number(b.deliveryCutoffHour))));
  }
  return out;
}

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    const [operational, content] = await Promise.all([getSettings(), getSiteSettings()]);
    return NextResponse.json({ ok: true, operational, content });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { operational?: unknown; content?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  try {
    const opPatch = sanitizeOperational(body.operational);
    const contentPatch = sanitizeContent(body.content);
    if (Object.keys(opPatch).length) await updateSettings(opPatch);
    if (Object.keys(contentPatch).length) await updateSiteSettings(contentPatch);
    const [operational, content] = await Promise.all([getSettings(), getSiteSettings()]);
    return NextResponse.json({ ok: true, operational, content });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
