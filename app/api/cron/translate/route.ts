import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n";
import {
  ensureUi,
  ensureCatalogTranslations,
  hasTranslationProvider,
  targetLocales,
} from "@/lib/translate";
import { ensureSiteContent } from "@/lib/site-settings-i18n";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Nachtelijke vertaal-cron (zie vercel.json). Zoekt elke avond nieuwe/gewijzigde
 * content en vertaalt die naar alle doeltalen (en/de/fr/es):
 *   - UI-microcopy (delta op de NL-bronsleutels) → KV-store
 *   - producttitels (delta) → product_translations
 *   - omschrijvingen + SEO alleen met ?descriptions=1 (duurder)
 *
 * Vercel-cron stuurt `Authorization: Bearer <CRON_SECRET>`; een ingelogde admin
 * mag 'm handmatig starten. Zonder AI-sleutel → 412 (er gebeurt niets).
 * Querystrings: ?locale=en (één taal) · ?descriptions=1 · ?products=0 · ?limit=400
 */
function secretOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${secret}` || new URL(req.url).searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  if (!secretOk(req)) {
    const customer = await getSessionCustomer().catch(() => null);
    if (!customer?.isAdmin) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!hasTranslationProvider()) {
    return NextResponse.json(
      { ok: false, error: "ANTHROPIC_API_KEY of OPENAI_API_KEY ontbreekt" },
      { status: 412 },
    );
  }

  const url = new URL(req.url);
  const descriptions = url.searchParams.get("descriptions") === "1";
  const skipProducts = url.searchParams.get("products") === "0";
  const only = url.searchParams.get("locale") || "";
  const limit = Math.max(1, Math.min(5000, Number(url.searchParams.get("limit")) || 400));
  const locales =
    only && isLocale(only) && only !== DEFAULT_LOCALE ? [only] : targetLocales();

  const result: Record<string, unknown> = {};
  for (const loc of locales) {
    const ui = await ensureUi(loc).catch((e) => ({ error: String((e as Error).message) }));
    // Portal-bewerkbare site-content (hero) — delta op de actuele bronteksten.
    const site = await ensureSiteContent(loc).catch((e) => ({ error: String((e as Error).message) }));
    const catalog = skipProducts
      ? { translated: 0, skipped: true }
      : await ensureCatalogTranslations(loc, { descriptions, limit }).catch((e) => ({
          error: String((e as Error).message),
        }));
    result[loc] = { ui, site, catalog };
  }

  return NextResponse.json({ ok: true, descriptions, result });
}
