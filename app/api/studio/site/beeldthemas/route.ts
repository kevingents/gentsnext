import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import {
  BRAND_RULES,
  DEFAULT_CRON,
  REALISM_RULE,
  getMediaThemes,
  shoesFor,
  updateMediaThemes,
  type CameraStyle,
  type MediaCronConfig,
  type MediaTheme,
  type MediaThemesStore,
} from "@/lib/media-themes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Portal /site → Beeldthema's. Bepaalt hoe de AI-sfeerbeelden eruitzien:
 * een THEMA (het waar) × een CAMERASTIJL (het hoe), plus de instellingen van de
 * nachtelijke generatie-cron.
 *
 * NIET hier: de merkregels (wit overhemd mét kraag, gilet onderste knoop open,
 * één mannelijk model). Die staan vast in lib/media-themes — in een vrij
 * tekstveld verdwijnen ze een keer en dan staat er een t-shirt onder een pak.
 * De portal krijgt ze wél te zien (`brandRules`) zodat de prompt-preview klopt.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 *
 * GET  → { ok, themes, cameraStyles, cron, categories, brandRules, realism }
 * POST → body { themes?, cameraStyles?, cron? } → opgeslagen + teruggegeven
 */

const SLOTS = ["lifestyle", "lifestyle2", "lifestyle3", "model2"] as const;

/** Maakt een stabiele id uit een label; valt terug op een teller als 't leeg wordt. */
function slug(label: string, i: number): string {
  const s = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || `thema-${i + 1}`;
}

function cleanThemes(input: unknown): MediaTheme[] | null {
  if (!Array.isArray(input)) return null;
  const out: MediaTheme[] = [];
  input.forEach((raw, i) => {
    const t = (raw ?? {}) as Partial<MediaTheme>;
    const label = String(t.label ?? "").trim();
    const scene = String(t.scene ?? "").trim();
    if (!label || !scene) return; // een thema zonder naam of scène doet niets
    out.push({
      id: String(t.id ?? "").trim() || slug(label, i),
      label,
      scene,
      light: String(t.light ?? "").trim(),
      categories: Array.isArray(t.categories) ? t.categories.map((c) => String(c).trim()).filter(Boolean) : [],
      ...(Array.isArray(t.handleMatch) && t.handleMatch.length
        ? { handleMatch: t.handleMatch.map((w) => String(w).trim().toLowerCase()).filter(Boolean) }
        : {}),
      ...(String(t.wearOverride ?? "").trim() ? { wearOverride: String(t.wearOverride).trim() } : {}),
      enabled: t.enabled !== false,
    });
  });
  return out;
}

function cleanCameraStyles(input: unknown): CameraStyle[] | null {
  if (!Array.isArray(input)) return null;
  const out: CameraStyle[] = [];
  input.forEach((raw, i) => {
    const c = (raw ?? {}) as Partial<CameraStyle>;
    const label = String(c.label ?? "").trim();
    const prompt = String(c.prompt ?? "").trim();
    if (!label || !prompt) return;
    out.push({ id: String(c.id ?? "").trim() || slug(label, i), label, prompt, enabled: c.enabled !== false });
  });
  return out;
}

/**
 * Cron-config schoonmaken. De grenzen worden hier hard afgedwongen, niet alleen in
 * de portal-UI: deze cron geeft geld uit (FASHN-credits). perRun boven 8 loopt tegen
 * Vercels 300s-limiet aan (halve batch, wél betaald) en minCreditsLeft op 0 zou de
 * noodrem uitschakelen.
 */
function cleanCron(input: unknown): MediaCronConfig | null {
  if (!input || typeof input !== "object") return null;
  const c = input as Partial<MediaCronConfig>;
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
  };
  return {
    enabled: c.enabled !== false,
    perRun: num(c.perRun, DEFAULT_CRON.perRun, 1, 8),
    maxCreditsPerRun: num(c.maxCreditsPerRun, DEFAULT_CRON.maxCreditsPerRun, 7, 2000),
    minCreditsLeft: num(c.minCreditsLeft, DEFAULT_CRON.minCreditsLeft, 50, 100000),
    slot: SLOTS.includes(c.slot as (typeof SLOTS)[number]) ? (c.slot as MediaCronConfig["slot"]) : DEFAULT_CRON.slot,
  };
}

/** Wat de portal nodig heeft om de prompt-preview te tonen zonder de regels te kunnen wijzigen. */
function readOnlyContext() {
  return {
    categories: Object.keys(BRAND_RULES),
    // Voorbeeldregel (navy colbert) — genoeg voor een preview, niet bewerkbaar.
    brandRuleExample: BRAND_RULES.Colberts(shoesFor("navy")),
    realism: REALISM_RULE,
  };
}

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await getMediaThemes()), ...readOnlyContext() });
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Partial<MediaThemesStore>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }

  const themes = cleanThemes(body.themes);
  const cameraStyles = cleanCameraStyles(body.cameraStyles);
  const cron = cleanCron(body.cron);
  if (!themes && !cameraStyles && !cron) {
    return NextResponse.json({ ok: false, error: "niets om op te slaan" }, { status: 400 });
  }
  // Alles uitzetten zou de generator stilletjes leeg laten draaien — expliciet blokkeren.
  if (themes && themes.length && !themes.some((t) => t.enabled)) {
    return NextResponse.json({ ok: false, error: "Zet minstens één thema aan." }, { status: 400 });
  }
  if (cameraStyles && cameraStyles.length && !cameraStyles.some((c) => c.enabled)) {
    return NextResponse.json({ ok: false, error: "Zet minstens één camerastijl aan." }, { status: 400 });
  }

  const saved = await updateMediaThemes({
    ...(themes ? { themes } : {}),
    ...(cameraStyles ? { cameraStyles } : {}),
    ...(cron ? { cron } : {}),
  });
  return NextResponse.json({ ok: true, ...saved, ...readOnlyContext() });
}
