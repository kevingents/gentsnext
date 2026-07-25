import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from "@/lib/i18n";
import {
  getTranslationStore,
  toTranslationRow,
  saveManualTranslation,
  resetTranslation,
  ensureUi,
  hasTranslationProvider,
  type TranslationRow,
} from "@/lib/translate";
import { ensureSiteContent } from "@/lib/site-settings-i18n";
import { ensureLandingsContent } from "@/lib/landings-i18n";
import { collectTranslationSources } from "@/lib/translation-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Vertalingen-beheer in de winkel zelf (Site-studio → Vindbaarheid → Vertalingen).
 * Zelfde werk als het portal-venster, maar met de gewone beheerders-sessie:
 *
 *   GET  ?locale=en&ns=ui&q=zoek&open=1&page=2 → { ok, rows, total, stats }
 *   POST { locale, ns, key, value }            → handmatige override (cron blijft eraf)
 *   POST { action:'reset', locale, ns, key }   → terug naar automatisch
 *   POST { action:'run', locale }              → vertaal nu (alleen het openstaande deel)
 *
 * Producttitels/-omschrijvingen lopen apart (product_translations, catalogus-cron);
 * hier staan alleen de site-teksten.
 */

/** Vaste paginagrootte: ~1500 sleutels zijn niet in één keer te overzien. */
const PAGE_SIZE = 50;

async function guard(): Promise<NextResponse | null> {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "niet ingelogd" }, { status: 401 });
  if (!customer.isAdmin) return NextResponse.json({ ok: false, error: "geen beheerrechten" }, { status: 403 });
  return null;
}

/** Doeltaal uit de request halen (NL is de bron, dus nooit een doeltaal). */
function targetLocale(raw: string): Locale | null {
  return isLocale(raw) && raw !== DEFAULT_LOCALE ? raw : null;
}

export async function GET(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  const url = new URL(req.url);
  const locale = targetLocale(String(url.searchParams.get("locale") || "en"));
  if (!locale) {
    return NextResponse.json({ ok: false, error: "Kies een doeltaal (en/de/fr/es)." }, { status: 400 });
  }
  const ns = String(url.searchParams.get("ns") || "").trim();
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const onlyOpen = url.searchParams.get("open") === "1";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const [sources, store] = await Promise.all([collectTranslationSources(), getTranslationStore(locale)]);
  const allRows: TranslationRow[] = sources.map((s) => toTranslationRow(store, s.ns, s.key, s.source));

  let rows = allRows;
  if (ns) rows = rows.filter((r) => r.ns === ns);
  if (q) {
    rows = rows.filter(
      (r) =>
        r.key.toLowerCase().includes(q) ||
        r.source.toLowerCase().includes(q) ||
        r.value.toLowerCase().includes(q),
    );
  }
  // "Nog te doen" = zonder vertaling, of vertaald vóór de brontekst wijzigde.
  if (onlyOpen) rows = rows.filter((r) => !r.value || !r.fresh);

  const stats = {
    totaal: allRows.length,
    vertaald: allRows.filter((r) => r.value).length,
    handmatig: allRows.filter((r) => r.manual).length,
    verouderd: allRows.filter((r) => r.value && !r.fresh && !r.manual).length,
  };
  const total = rows.length;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, maxPage);

  return NextResponse.json({
    ok: true,
    locale,
    rows: rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    total,
    page: safePage,
    pageSize: PAGE_SIZE,
    stats,
    locales: LOCALES.filter((l) => l !== DEFAULT_LOCALE),
  });
}

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  let body: { action?: string; locale?: string; ns?: string; key?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }

  const locale = targetLocale(String(body.locale || ""));
  if (!locale) {
    return NextResponse.json({ ok: false, error: "Kies een doeltaal (en/de/fr/es)." }, { status: 400 });
  }
  const action = String(body.action || "save");

  if (action === "run") {
    // Vertaal nu: hetzelfde delta-werk als de nachtelijke cron, voor één taal.
    if (!hasTranslationProvider()) {
      return NextResponse.json(
        { ok: false, error: "Geen AI-sleutel op de server (ANTHROPIC_API_KEY) — de vertaal-run kan niet draaien." },
        { status: 412 },
      );
    }
    const asError = (e: unknown) => ({ error: String((e as Error)?.message || e) });
    const ui = await ensureUi(locale).catch(asError);
    const site = await ensureSiteContent(locale).catch(asError);
    const landings = await ensureLandingsContent(locale).catch(asError);
    return NextResponse.json({ ok: true, ui, site, landings });
  }

  const ns = String(body.ns || "").trim();
  const key = String(body.key || "").trim();
  if (!ns || !key) return NextResponse.json({ ok: false, error: "ns + key vereist." }, { status: 400 });

  if (action === "reset") {
    await resetTranslation(locale, ns, key);
    return NextResponse.json({ ok: true, reset: true });
  }

  // Handmatige override: de bron erbij zoeken, zodat de opgeslagen hash bij de
  // HUIDIGE Nederlandse tekst hoort (anders lijkt de override meteen verouderd).
  const src = (await collectTranslationSources()).find((s) => s.ns === ns && s.key === key);
  if (!src) return NextResponse.json({ ok: false, error: "Onbekende sleutel." }, { status: 404 });
  const value = String(body.value || "").trim();
  if (!value) {
    return NextResponse.json(
      { ok: false, error: "Vul een vertaling in (of zet 'm terug op automatisch)." },
      { status: 400 },
    );
  }
  await saveManualTranslation(locale, ns, key, src.source, value);
  return NextResponse.json({ ok: true, saved: true });
}
