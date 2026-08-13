import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import {
  DEFAULT_CRON,
  getMediaThemes,
  updateMediaThemes,
  type CameraStyle,
  type MediaCronConfig,
  type MediaTheme,
  type MediaThemesStore,
} from "@/lib/media-themes";

export const dynamic = "force-dynamic";

/** Recht "presentatie": beeldthema's en camerastijlen voor de AI-media-generatie. */

export async function GET() {
  if (!(await requirePermission("presentatie"))) {
    return NextResponse.json(
      { ok: false, error: "Geen toegang: hiervoor heb je het werkgebied Presentatie nodig." },
      { status: 403 }
    );
  }
  return NextResponse.json({ ok: true, ...(await getMediaThemes()) });
}

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
    out.push({
      id: String(c.id ?? "").trim() || slug(label, i),
      label,
      prompt,
      enabled: c.enabled !== false,
    });
  });
  return out;
}

const SLOTS = ["lifestyle", "lifestyle2", "lifestyle3", "model2"] as const;

/**
 * Cron-config schoonmaken. De grenzen worden hier hard afgedwongen, niet alleen
 * in de UI: perRun boven 8 loopt tegen Vercels 300s-limiet aan (halve batch, wél
 * betaald), en een minCreditsLeft van 0 zou de noodrem uitschakelen.
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

export async function POST(req: Request) {
  if (!(await requirePermission("presentatie"))) {
    return NextResponse.json(
      { ok: false, error: "Geen toegang: hiervoor heb je het werkgebied Presentatie nodig." },
      { status: 403 }
    );
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
  return NextResponse.json({ ok: true, ...saved });
}
