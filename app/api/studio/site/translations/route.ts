import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from "@/lib/i18n";
import { uiSourceKeys } from "@/lib/messages";
import { getSiteSettings } from "@/lib/site-settings";
import { LANDINGS } from "@/lib/landings";
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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Portal-"Nieuwe site"-CMS → Vertalingen. Beheer van de automatische vertalingen
 * (UI-microcopy, hero, landings) uit de KV-store `translations:<locale>`:
 *
 *   GET  ?locale=en&ns=ui&q=zoek&page=1  → { ok, rows, total, stats, locales }
 *   POST { locale, ns, key, value }      → handmatige override (cron blijft eraf)
 *   POST { action:'reset', locale, ns, key } → terug naar automatisch (cron her-vertaalt)
 *   POST { action:'run', locale }        → vertaal nu (delta) voor één taal
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN. Producttitels/-omschrijvingen lopen
 * apart (product_translations, via de catalogus-cron) — hier alleen de site-teksten.
 */

/** Alle NL-bronnen per namespace (bron-van-waarheid voor de lijst). */
async function allSources(): Promise<{ ns: string; key: string; source: string }[]> {
  const out: { ns: string; key: string; source: string }[] = [];
  for (const e of uiSourceKeys()) out.push({ ns: "ui", key: e.key, source: e.source });
  try {
    const s = await getSiteSettings();
    const add = (key: string, source?: string) => {
      const v = (source || "").trim();
      if (v && !/^suits\s+you$/i.test(v)) out.push({ ns: "site", key, source: v });
    };
    add("hero.eyebrow", s.hero.eyebrow);
    add("hero.title", s.hero.title);
    add("hero.subtitle", s.hero.subtitle);
    add("hero.primary.label", s.hero.primary?.label);
    add("hero.secondary.label", s.hero.secondary?.label);
  } catch { /* settings onbereikbaar → alleen ui */ }
  for (const l of Object.values(LANDINGS)) {
    if (l.handle.startsWith("_")) continue;
    const add = (key: string, source?: string) => {
      const v = (source || "").trim();
      if (v) out.push({ ns: "landing", key: `${l.handle}.${key}`, source: v });
    };
    add("eyebrow", l.eyebrow);
    add("title", l.title);
    add("intro", l.intro);
    add("cta.label", l.cta?.label);
    l.sections.forEach((s2, i) => { add(`sections.${i}.title`, s2.title); add(`sections.${i}.body`, s2.body); });
    l.shop.forEach((s2, i) => add(`shop.${i}.label`, s2.label));
  }
  return out;
}

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  const url = new URL(req.url);
  const locale = String(url.searchParams.get("locale") || "en");
  if (!isLocale(locale) || locale === DEFAULT_LOCALE) {
    return NextResponse.json({ ok: false, error: "Kies een doeltaal (en/de/fr/es)." }, { status: 400 });
  }
  const ns = String(url.searchParams.get("ns") || "");
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const onlyMissing = url.searchParams.get("missing") === "1";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = 50;

  const [sources, store] = await Promise.all([allSources(), getTranslationStore(locale as Locale)]);
  let rows: TranslationRow[] = sources.map((s) => toTranslationRow(store, s.ns, s.key, s.source));
  if (ns) rows = rows.filter((r) => r.ns === ns);
  if (q) rows = rows.filter((r) => r.key.toLowerCase().includes(q) || r.source.toLowerCase().includes(q) || r.value.toLowerCase().includes(q));
  if (onlyMissing) rows = rows.filter((r) => !r.value || !r.fresh);

  const allRows = sources.map((s) => toTranslationRow(store, s.ns, s.key, s.source));
  const stats = {
    totaal: sources.length,
    vertaald: allRows.filter((r) => r.value).length,
    handmatig: allRows.filter((r) => r.manual).length,
    // vertaald maar bron sindsdien gewijzigd (wacht op de volgende cron-run)
    verouderd: allRows.filter((r) => r.value && !r.fresh && !r.manual).length,
  };
  const total = rows.length;
  rows = rows.slice((page - 1) * pageSize, page * pageSize);

  return NextResponse.json({ ok: true, rows, total, page, pageSize, stats, locales: LOCALES.filter((l) => l !== DEFAULT_LOCALE) });
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  let b: { action?: string; locale?: string; ns?: string; key?: string; value?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const locale = String(b.locale || "");
  if (!isLocale(locale) || locale === DEFAULT_LOCALE) {
    return NextResponse.json({ ok: false, error: "Kies een doeltaal (en/de/fr/es)." }, { status: 400 });
  }
  const action = String(b.action || "save");

  if (action === "run") {
    // Vertaal nu (delta): zelfde werk als de nachtelijke cron, voor één taal.
    if (!hasTranslationProvider()) {
      return NextResponse.json({ ok: false, error: "Geen AI-sleutel op de server (ANTHROPIC_API_KEY) — de vertaal-run kan niet draaien." }, { status: 412 });
    }
    const ui = await ensureUi(locale as Locale).catch((e) => ({ error: String((e as Error).message) }));
    const site = await ensureSiteContent(locale as Locale).catch((e) => ({ error: String((e as Error).message) }));
    const landings = await ensureLandingsContent(locale as Locale).catch((e) => ({ error: String((e as Error).message) }));
    return NextResponse.json({ ok: true, ui, site, landings });
  }

  const ns = String(b.ns || "").trim();
  const key = String(b.key || "").trim();
  if (!ns || !key) return NextResponse.json({ ok: false, error: "ns + key vereist." }, { status: 400 });

  if (action === "reset") {
    await resetTranslation(locale as Locale, ns, key);
    return NextResponse.json({ ok: true, reset: true });
  }

  // Handmatige override: bron opzoeken (hash hoort bij de huidige bron).
  const src = (await allSources()).find((s) => s.ns === ns && s.key === key);
  if (!src) return NextResponse.json({ ok: false, error: "Onbekende sleutel." }, { status: 404 });
  const value = String(b.value || "").trim();
  if (!value) return NextResponse.json({ ok: false, error: "Vul een vertaling in (of gebruik reset voor automatisch)." }, { status: 400 });
  await saveManualTranslation(locale as Locale, ns, key, src.source, value);
  return NextResponse.json({ ok: true, saved: true });
}
