import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { isBlackTie } from "@/lib/model-styling";

/**
 * Beeldthema's voor de AI-media-generatie. Drie lagen, bewust gescheiden:
 *
 *  1. MERKREGELS  — code, hieronder in BRAND_RULES. Wit overhemd mét kraag, gilet
 *     onderste knoop open, één mannelijk model. Staat NIET in de portal: als dit
 *     in een vrij tekstveld staat verdwijnt het een keer en staat er een t-shirt
 *     onder een pak.
 *  2. THEMA       — het WAAR (Provence, Highlands, stad). Portal-beheerbaar.
 *  3. CAMERASTIJL — het HOE (tegenlicht, lage hoek, raamlicht, doorkijk).
 *     Portal-beheerbaar, maar dit is de GENTS-signatuur; wijzig 'm zelden.
 *
 * Waarom gesplitst: gen:lifestyle plakte scène en licht aan elkaar in één MOOD,
 * dus 5 thema's gaven 5 looks. Los van elkaar geeft 5 thema's × 4 camerastijlen
 * 20 unieke looks, en kun je thema's per seizoen wisselen zonder de huisstijl-
 * fotografie aan te raken.
 *
 * Bron van waarheid = DB-rij app_settings.media-themes (portal → Presentatie →
 * Beeldthema's), met DEFAULT_THEMES/DEFAULT_CAMERA_STYLES als fallback. Zo voegt
 * marketing een thema toe zonder code en zonder redeploy.
 */

const MODEL = "One single male model, alone in frame,";
const SHIRT = "a crisp white dress shirt with a buttoned collar — never a t-shirt";

/**
 * Schoenkleur volgt de huisregel: bruin bij warme/lichte kleuren, zwart bij een
 * zwart of antracietgrijs kledingstuk. Zonder deze splitsing kreeg een zwart
 * colbert bruine schoenen — precies wat de stijlregel verbiedt.
 */
export function shoesFor(color: string, title = ""): string {
  const s = `${color} ${title}`.toLowerCase();
  const donker = /\b(zwart|black|antraciet|anthracite|charcoal|donkergrijs)\b/.test(s);
  return donker ? "black leather shoes" : "brown leather shoes";
}

/**
 * Kledingregel per hoofdgroep — de merkregels, niet portal-beheerbaar.
 * `shoes` komt uit shoesFor() zodat de schoenkleur bij het kledingstuk past.
 */
export const BRAND_RULES: Record<string, (shoes: string) => string> = {
  Pakken: (shoes) => `${MODEL} wearing THIS suit with ${SHIRT} and ${shoes}.`,
  Colberts: (shoes) => `${MODEL} wearing THIS blazer over ${SHIRT}, with matching trousers and ${shoes}.`,
  Broeken: (shoes) => `${MODEL} wearing THESE trousers with a tucked-in ${SHIRT} and ${shoes}.`,
  Gilets: (shoes) =>
    `${MODEL} wearing THIS waistcoat over ${SHIRT}, with matching trousers and ${shoes}. The bottom button of the waistcoat is always left undone (open).`,
  Overhemden: (shoes) => `${MODEL} wearing THIS shirt with the collar buttoned, neat trousers and ${shoes}.`,
  Truien: () => `${MODEL} wearing THIS knitwear over a shirt collar, with neat trousers and leather boots.`,
  Vesten: () => `${MODEL} wearing THIS cardigan over a shirt, with neat trousers and leather boots.`,
  Jassen: () => `${MODEL} wearing THIS coat over neat menswear, with trousers and leather boots.`,
  "Polo-shirts": () => `${MODEL} wearing THIS polo shirt with light chino trousers and brown suede loafers.`,
  "T-Shirts": () => `${MODEL} wearing THIS t-shirt with light chino trousers, a relaxed summer look.`,
};

/**
 * Black-tie wint van de hoofdgroep-regel. Zonder deze uitzondering kreeg een
 * SMOKING-colbert de zomerse Colberts-styling ("sand trousers, brown loafers").
 * Zat eerder alléén in de studio-hergeneratie, dus het script en de cron hadden
 * die blinde vlek nog — zelfde patroon als bij de learnings.
 */
export const BLACK_TIE_RULE = `${MODEL} wearing THIS item as part of a complete black-tie tuxedo outfit — a crisp white formal dress shirt with a buttoned collar, a black bow tie, black tuxedo trousers and black patent leather shoes.`;

/** Vaste kwaliteitsregel — hoort bij de merkfotografie, niet bij een thema. */
export const REALISM_RULE =
  "Authentic editorial photograph shot on 35mm film with visible natural grain, real skin texture and natural fabric creases — raw and real, NOT glossy, NOT airbrushed, NOT studio-perfect. The garment must stay accurate to the reference photo in colour, weave and cut.";

export type MediaTheme = {
  /** Stabiele sleutel; wordt niet hernoemd als het label verandert. */
  id: string;
  /** Naam in de portal, bv. "Zuid-Frankrijk bruiloft". */
  label: string;
  /** De scène in het Engels — dit gaat letterlijk de prompt in. */
  scene: string;
  /** Het licht/de kleurtoon, ook Engels. */
  light: string;
  /** Voor welke hoofdgroepen dit thema geldt (attributes.hoofdgroep_omschrijving). */
  categories: string[];
  /**
   * Optionele extra selectie op handle/titel, voor groepen die je niet op
   * hoofdgroep kunt vangen — bv. rokkostuum en jacquet, die als "Pakken" in de
   * data staan maar een heel andere sfeer vragen. Losse woorden, kleine letters.
   * Staat dit gevuld, dan wint dit thema van een thema dat alléén op categorie matcht.
   */
  handleMatch?: string[];
  /** Kledingregel die de merkregel van de hoofdgroep vervángt (alleen voor handleMatch-thema's). */
  wearOverride?: string;
  enabled: boolean;
};

export type CameraStyle = {
  id: string;
  label: string;
  /** Beschrijf de CAMERA (licht, hoek, scherptediepte) — niet de gebeurtenis. */
  prompt: string;
  enabled: boolean;
};

/**
 * Cron-instellingen. Deze job geeft geld uit (FASHN-credits), dus alles staat
 * begrensd: een maximum per run én een ondergrens waaronder de cron zichzelf
 * stopzet. Zonder die twee draait een nachtelijke job het saldo leeg.
 */
export type MediaCronConfig = {
  enabled: boolean;
  /** Beelden per run. Vercel kapt de functie af op 300s; ±1 minuut per beeld. */
  perRun: number;
  /** Harde bovengrens op credits per run. */
  maxCreditsPerRun: number;
  /** Onder dit saldo doet de cron niets meer — de noodrem. */
  minCreditsLeft: number;
  /** Welk slot de cron vult. */
  slot: "lifestyle" | "lifestyle2" | "lifestyle3" | "model2";
};

export const DEFAULT_CRON: MediaCronConfig = {
  enabled: true,
  perRun: 4,
  maxCreditsPerRun: 40,
  minCreditsLeft: 500,
  slot: "lifestyle",
};

export type MediaThemesStore = { themes: MediaTheme[]; cameraStyles: CameraStyle[]; cron: MediaCronConfig };

export const DEFAULT_THEMES: MediaTheme[] = [
  {
    id: "zuid-frankrijk",
    label: "Zuid-Frankrijk bruiloft",
    scene:
      "in the sun-drenched South of France: a dry summer field of grass and lavender in the Provence, whitewashed village steps, olive groves and old limestone walls",
    light: "Warm golden-hour Mediterranean sunlight, sun-drenched, soft warm tones",
    categories: ["Pakken", "Colberts", "Gilets"],
    enabled: true,
  },
  {
    id: "highlands",
    label: "Schotse Highlands",
    scene:
      "on a windswept Scottish Highland moor covered in heather, rugged misty mountains, a still grey loch and weathered stone walls behind him",
    light: "Moody dramatic overcast Highland light, atmospheric and cinematic, cool desaturated tones",
    categories: ["Truien", "Vesten", "Jassen"],
    enabled: true,
  },
  {
    id: "stad",
    label: "Stad / smart casual",
    scene:
      "in an old European city: sunlit cobbled streets, grand historic facades, a marble cafe terrace and a canal bridge railing",
    light: "Soft natural European city daylight, stylish, easy and relaxed",
    categories: ["Overhemden", "Broeken", "T-Shirts"],
    enabled: true,
  },
  {
    id: "colourful-urban",
    label: "Colourful urban",
    scene:
      "against bold, saturated urban colour: a painted concrete wall in a strong single colour, colourful shutters and awnings, graphic city geometry — the background colour deliberately contrasting with the garment",
    light: "Bright punchy daylight with clean hard shadows, vivid saturated colour, confident and modern",
    categories: ["Polo-shirts", "T-Shirts", "Overhemden"],
    enabled: true,
  },
  {
    id: "winter-alpen",
    label: "Winter / Alpen",
    scene:
      "in a crisp alpine winter: snow-dusted pine forest, an old wooden chalet wall, still mountain air and distant peaks",
    light: "Cool clear winter daylight, crisp and bright, soft blue shadows on snow",
    categories: ["Jassen", "Truien", "Vesten"],
    enabled: true,
  },
  {
    // Rokkostuum/jacquet staan als "Pakken" in de data maar vragen een heel andere
    // sfeer — vandaar de selectie op handle/titel in plaats van op hoofdgroep.
    id: "student",
    label: "Studentikoos (rok & jacquet)",
    scene:
      "in a lively Dutch student setting: a sunny canal bridge in Leiden or Amsterdam, gabled canal houses, bikes against the railing, the worn stone steps of an old university building",
    light: "Bright natural Dutch daylight, lively, playful and cheerful",
    categories: [],
    handleMatch: ["rok", "rokkostuum", "rokjas", "jacquet"],
    wearOverride:
      "One single cheerful young male student, alone in frame, wearing THIS formal item as part of a full white-tie tailcoat outfit — crisp white dress shirt with a buttoned collar, white bow tie and formal black trousers.",
    enabled: true,
  },
];

export const DEFAULT_CAMERA_STYLES: CameraStyle[] = [
  {
    id: "tegenlicht",
    label: "Tegenlicht",
    prompt:
      "Backlit portrait: the sun sits low and directly behind him, flaring into the lens with warm rays and a soft haze, rim-lighting his hair and shoulders. He walks slowly toward the camera. Framed from mid-thigh up, a calm unforced expression. Shallow depth of field.",
    enabled: true,
  },
  {
    id: "lage-hoek",
    label: "Lage hoek tegen de lucht",
    prompt:
      "Low-angle shot taken from below, so he stands tall against a wide open sky with nothing else behind him. Hands relaxed at his sides, looking off to the side. Full-length framing from below, clean and graphic.",
    enabled: true,
  },
  {
    id: "raamlicht",
    label: "Zacht raamlicht",
    prompt:
      "Soft daylight portrait beside a tall window, a sheer linen curtain diffusing the light across him, calm and minimal surroundings. Framed from the knees up, a quiet natural expression, looking toward the window light.",
    enabled: true,
  },
  {
    id: "doorkijk",
    label: "Doorkijk / omlijst",
    prompt:
      "He stands framed inside an archway or doorway, the darker frame forming a hard edge around him and a brighter space visible through the opening behind. Hands in his pockets, weight on one leg, a steady calm look into the camera. Full-length, strong contrast between shade and the light beyond.",
    enabled: true,
  },
];

let _cache: MediaThemesStore | null = null;
let _at = 0;
const TTL = 30_000;

/** Server-getter: DB-overrides over de defaults, met korte cache (zoals site-settings). */
export async function getMediaThemes(): Promise<MediaThemesStore> {
  if (_cache && Date.now() - _at < TTL) return _cache;
  let stored: Partial<MediaThemesStore> = {};
  try {
    const db = getDb();
    const rows = await db.select().from(appSettings).where(eq(appSettings.id, "media-themes")).limit(1);
    stored = (rows[0]?.data ?? {}) as Partial<MediaThemesStore>;
  } catch {
    stored = {};
  }
  _cache = {
    themes: Array.isArray(stored.themes) && stored.themes.length ? stored.themes : DEFAULT_THEMES,
    cameraStyles:
      Array.isArray(stored.cameraStyles) && stored.cameraStyles.length ? stored.cameraStyles : DEFAULT_CAMERA_STYLES,
    cron: { ...DEFAULT_CRON, ...(stored.cron ?? {}) },
  };
  _at = Date.now();
  return _cache;
}

/** Slaat de hele lijst op (portal) en leegt de cache. */
export async function updateMediaThemes(patch: Partial<MediaThemesStore>): Promise<MediaThemesStore> {
  const db = getDb();
  const current = await getMediaThemes();
  const next: MediaThemesStore = {
    themes: Array.isArray(patch.themes) ? patch.themes : current.themes,
    cameraStyles: Array.isArray(patch.cameraStyles) ? patch.cameraStyles : current.cameraStyles,
    cron: { ...current.cron, ...(patch.cron ?? {}) },
  };
  await db
    .insert(appSettings)
    .values({ id: "media-themes", data: next, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: appSettings.id, set: { data: next, updatedAt: sql`now()` } });
  _cache = null;
  _at = 0;
  return getMediaThemes();
}

/**
 * Het thema voor een product. Een handleMatch-thema (rok/jacquet) wint van een
 * thema dat alleen op hoofdgroep matcht — anders zou "Pakken" het rokkostuum
 * opslokken en krijgt een jacquet een bruiloftsscène.
 */
export function themeForProduct(
  store: MediaThemesStore,
  product: { hoofdgroep: string; handle?: string; title?: string }
): MediaTheme | null {
  const hay = `${product.handle ?? ""} ${product.title ?? ""}`.toLowerCase();
  const opNaam = store.themes.find(
    (t) => t.enabled && t.handleMatch?.length && t.handleMatch.some((w) => hay.includes(w.toLowerCase()))
  );
  if (opNaam) return opNaam;
  return store.themes.find((t) => t.enabled && t.categories.includes(product.hoofdgroep)) ?? null;
}

/**
 * Bouwt de volledige FASHN-prompt: merkregel + camerastijl + thema + realisme.
 * Volgorde is bewust — het kledingstuk eerst, dan hoe het gefotografeerd is,
 * dan waar, dan de kwaliteitseis.
 */
export function buildPrompt(
  product: { hoofdgroep: string; color?: string; title?: string; handle?: string },
  theme: MediaTheme,
  camera: CameraStyle
): string | null {
  // Volgorde: thema-override (rok/jacquet) → black-tie → de hoofdgroep-regel.
  const gala = isBlackTie(product.hoofdgroep, product.title ?? "", product.handle ?? "");
  const wear =
    theme.wearOverride ||
    (gala ? BLACK_TIE_RULE : BRAND_RULES[product.hoofdgroep]?.(shoesFor(product.color ?? "", product.title)));
  if (!wear) return null;
  return `${wear} ${camera.prompt} He is ${theme.scene}. ${theme.light}. ${REALISM_RULE}`;
}
