import { list, put, del } from "@vercel/blob";

/**
 * Hero-/bannerbeelden: de merkbeelden bovenaan de homepage en de
 * landingspagina's. Gemaakt met fal.ai (FLUX) — tekst-naar-beeld, vanaf nul.
 *
 * WAAROM NIET FASHN: FASHN is virtuele pas-techniek (een écht kledingstuk op
 * een model zetten). Het heeft geen tekst-naar-beeld en kan dus geen straat,
 * atelier of bruiloft verzinnen. FASHN blijft voor product-op-model met onze
 * eigen artikelen; banners maakt fal.ai. Zie lib/model-photo.ts voor de andere
 * kant van die scheiding.
 *
 * Opslag: Vercel Blob onder `ai-hero/<slug>.jpg`. Dat is dezelfde plek waar
 * scripts/generate-hero-media.ts al schreef, zodat de banners die er al staan
 * meteen in de beeldbank verschijnen.
 *
 * Merkregels in de prompt: getailleerd pak mét wit overhemd (nooit een T-shirt
 * onder een colbert), onderste gilet-knoop open, en GEEN tekst/logo in beeld —
 * de wordmark komt als echte overlay ([[gents-logo-onaantastbaar]]).
 */

export const HERO_MODEL = process.env.FAL_HERO_MODEL || "fal-ai/flux-pro/v1.1-ultra";

/** Kwaliteits-/merkcues, neutraal qua licht zodat elk thema z'n eigen sfeer zet. */
export const HERO_STYLE =
  "Editorial menswear campaign photograph for an upscale, refined men's formalwear brand — aspirational yet wearable. Impeccably tailored suits worn over a crisp collared dress shirt — never a t-shirt under a jacket. When a waistcoat or three-piece suit appears, the bottom button of the waistcoat is always left undone (open). Photorealistic high-end fashion photography, sharp and elegant, subtle film grain, generous negative space for a headline. Absolutely no text, no logo, no watermark, no caption anywhere in the image.";

export type HeroThema = { slug: string; label: string; aspect: string; prompt: string };

/**
 * De vaste thema's. Staan hier (niet in een blob-config) omdat het prompts zijn:
 * broncode-materiaal dat je met een diff wilt kunnen volgen. Een eigen banner
 * maak je met een vrije omschrijving, daar hoeft geen thema voor bij.
 */
export const HERO_THEMAS: HeroThema[] = [
  { slug: "peaky-blinders", label: "Peaky Blinders", aspect: "21:9",
    prompt: "Three sharply dressed men in 1920s-style tweed and herringbone three-piece suits with buttoned waistcoats, ties and flat caps, standing confident and brooding on a moody cobblestone industrial street at dusk, dramatic overcast light, atmospheric haze, cinematic vintage colour grade." },
  { slug: "italiaanse-zomer", label: "Italiaanse zomer", aspect: "21:9",
    prompt: "An effortlessly elegant man in a light linen summer suit and loafers leaning on a sun-bleached balustrade above a glittering Italian coastline, warm midday Mediterranean light, relaxed dolce-vita mood, vivid and bright." },
  { slug: "gala-black-tie", label: "Gala / black tie", aspect: "21:9",
    prompt: "A distinguished man in an impeccable black tuxedo with a black bow tie and white dress shirt in a grand dimly-lit classical hall, warm chandelier glow, refined black-tie elegance, cinematic and moody." },
  { slug: "dandy", label: "Dandy", aspect: "16:9",
    prompt: "A stylish modern dandy in a bold patterned three-piece suit with a pocket square and confident flair, against a richly coloured vintage interior with velvet and brass, warm directional light, characterful and elegant." },
  { slug: "wedding-golden-hour", label: "Bruiloft — gouden uur", aspect: "21:9",
    prompt: "Two stylish male wedding guests in elegant light-toned suits laughing together on the sun-drenched whitewashed steps of a Mediterranean coastal village at golden hour, the turquoise sea glittering behind them, relaxed and joyful." },
  { slug: "city-editorial", label: "Stad — editorial", aspect: "21:9",
    prompt: "A confident, well-dressed man in a sharp navy tailored suit walking a sunlit historic European city street in the soft early morning, relaxed elegant stride, warm tones, candid and timeless." },
  { slug: "atelier-tailor", label: "Atelier", aspect: "16:9",
    prompt: "A refined tailor's atelier bathed in warm window light; a man in a three-piece suit adjusts his cuff before a tall antique mirror, rolls of fine wool fabric and a measuring tape softly out of focus." },
  { slug: "terrace-aperitivo", label: "Terras / aperitivo", aspect: "21:9",
    prompt: "A group of well-dressed men in smart summer suits relaxing at a sunlit Italian terrace cafe, glasses raised in a warm toast, colourful old-town facades behind, lively and elegant golden-hour light." },
  { slug: "business-portrait", label: "Zakelijk portret", aspect: "16:9",
    prompt: "A distinguished man in a charcoal business suit and white shirt standing calm and confident in a bright modern interior with soft daylight, understated luxury, clean refined composition." },
  { slug: "autumn-knitwear", label: "Herfst — knitwear", aspect: "21:9",
    prompt: "A man in fine autumn knitwear over a shirt collar and tailored trousers walking a misty tree-lined lane in soft overcast light, warm earthy tones, refined countryside elegance." },
  { slug: "landing-zakelijk", label: "Landing — zakelijk", aspect: "3:2",
    prompt: "A confident businessman in a sharp charcoal tailored suit and crisp white shirt standing in a bright modern glass-walled office boardroom, professional and approachable, soft clean daylight, plenty of space on the left for a headline." },
  { slug: "landing-students", label: "Landing — students", aspect: "3:2",
    prompt: "A lively group of young men in black-tie tuxedos and white-tie tailcoats raising a toast at an elegant candle-lit student-society gala dinner, celebratory and warm, golden ambient light, characterful and joyful." },
  { slug: "landing-etiquette", label: "Landing — etiquette", aspect: "3:2",
    prompt: "An impeccably dressed man in formal black-tie attire adjusting his black bow tie, refined detail on the wing-collar white shirt, cufflinks and pocket square, classic and educational, warm soft directional light, elegant and timeless." },
];

/** Beeldverhoudingen die het model aankan; alles daarbuiten wordt 21:9. */
export const HERO_ASPECTS = ["21:9", "16:9", "3:2", "4:3", "1:1"] as const;

export type HeroBeeld = {
  /** Bestandsnaam zonder map/extensie — ook het label als er geen thema bij past. */
  slug: string;
  label: string;
  url: string;
  /** Thema-slug als dit beeld uit de vaste lijst komt, anders leeg. */
  thema: string;
  aspect: string;
  gemaaktOp: string;
  bytes: number;
};

function blobToken(): string {
  const t = process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
  if (!t) throw new Error("Geen blob-token (STOREGENTS_BLOB_READ_WRITE_TOKEN of BLOB_READ_WRITE_TOKEN).");
  return t;
}

/** Maakt van "wedding-golden-hour-2" een leesbaar label. */
function labelVoor(slug: string): string {
  const thema = HERO_THEMAS.find((h) => slug === h.slug || slug.startsWith(`${h.slug}-`));
  if (thema) {
    const variant = slug.slice(thema.slug.length).replace(/^-/, "");
    return variant ? `${thema.label} ${variant}` : thema.label;
  }
  const woorden = slug.replace(/[-_]+/g, " ").trim();
  return woorden.charAt(0).toUpperCase() + woorden.slice(1);
}

/**
 * Alle bestaande hero-banners uit de blob. Nieuwste eerst — je zoekt bijna
 * altijd wat je zojuist hebt laten maken.
 */
export async function listHeroBeelden(): Promise<HeroBeeld[]> {
  const { blobs } = await list({ prefix: "ai-hero/", limit: 500, token: blobToken() });
  return blobs
    .filter((b) => /\.(jpe?g|png|webp)$/i.test(b.pathname))
    .map((b) => {
      const slug = b.pathname.replace(/^ai-hero\//, "").replace(/\.[a-z0-9]+$/i, "");
      const thema = HERO_THEMAS.find((h) => slug === h.slug || slug.startsWith(`${h.slug}-`));
      return {
        slug,
        label: labelVoor(slug),
        url: b.url,
        thema: thema?.slug || "",
        aspect: thema?.aspect || "",
        gemaaktOp: new Date(b.uploadedAt).toISOString(),
        bytes: b.size,
      };
    })
    .sort((a, b) => b.gemaaktOp.localeCompare(a.gemaaktOp));
}

/** Verwijdert een banner (alleen binnen ai-hero/, nooit ergens anders). */
export async function verwijderHeroBeeld(slug: string): Promise<boolean> {
  const veilig = slugify(slug);
  if (!veilig) return false;
  const beelden = await listHeroBeelden();
  const hit = beelden.find((b) => b.slug === veilig);
  if (!hit) return false;
  await del(hit.url, { token: blobToken() });
  return true;
}

/** Bestandsnaam-veilige slug; houdt paden binnen ai-hero/. */
export function slugify(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function falImage(prompt: string, aspect: string): Promise<string | null> {
  const key = process.env.FAL_KEY || process.env.FAL_API_KEY || "";
  if (!key) throw new Error("FAL_KEY ontbreekt.");
  const res = await fetch(`https://fal.run/${HERO_MODEL}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: `${prompt} ${HERO_STYLE}`,
      aspect_ratio: aspect,
      num_images: 1,
      output_format: "jpeg",
      enable_safety_checker: true,
      safety_tolerance: "5",
    }),
  });
  if (!res.ok) throw new Error(`fal ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { images?: { url?: string }[] };
  return j?.images?.[0]?.url || null;
}

/** Haalt het beeld op en zet het als `ai-hero/<slug>.jpg` in de blob. */
export async function bewaarHeroBeeld(srcUrl: string, slug: string): Promise<string> {
  const r = await fetch(srcUrl);
  if (!r.ok) throw new Error(`Beeld ophalen mislukt (${r.status}).`);
  const blob = await put(`ai-hero/${slug}.jpg`, await r.arrayBuffer(), {
    access: "public",
    token: blobToken(),
    contentType: "image/jpeg",
    allowOverwrite: true,
  });
  return blob.url;
}

/**
 * Maakt één banner. `thema` pakt een prompt uit de vaste lijst, `prompt` is een
 * vrije omschrijving (de merk-/stijlregels komen er altijd bij). Bestaande
 * bestandsnaam? Dan krijgt de nieuwe er een volgnummer achter, zodat een
 * banner die al op de site staat niet onder je handen verandert.
 */
export async function maakHeroBeeld(opts: {
  thema?: string;
  prompt?: string;
  aspect?: string;
  naam?: string;
}): Promise<HeroBeeld> {
  const thema = HERO_THEMAS.find((h) => h.slug === opts.thema);
  const prompt = (opts.prompt || "").trim() || thema?.prompt || "";
  if (!prompt) throw new Error("Geen thema of omschrijving opgegeven.");

  const aspect = (HERO_ASPECTS as readonly string[]).includes(opts.aspect || "")
    ? (opts.aspect as string)
    : thema?.aspect || "21:9";

  const basis = slugify(opts.naam || thema?.slug || prompt.split(/\s+/).slice(0, 5).join("-")) || "hero";
  const bestaand = new Set((await listHeroBeelden()).map((b) => b.slug));
  let slug = basis;
  for (let n = 2; bestaand.has(slug) && n < 100; n++) slug = `${basis}-${n}`;

  const src = await falImage(prompt, aspect);
  if (!src) throw new Error("fal.ai gaf geen beeld terug.");
  const url = await bewaarHeroBeeld(src, slug);

  return {
    slug,
    label: labelVoor(slug),
    url,
    thema: thema?.slug || "",
    aspect,
    gemaaktOp: new Date().toISOString(),
    bytes: 0,
  };
}
