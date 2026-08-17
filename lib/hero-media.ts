import { list, put, del } from "@vercel/blob";

/**
 * Hero-/bannerbeelden: de merkbeelden bovenaan de homepage en de
 * landingspagina's. Gemaakt met fal.ai (FLUX) — tekst-naar-beeld, vanaf nul.
 *
 * DRIE WEGEN, en de eerste vraag is "hangt er een echt artikel in beeld?":
 *
 *  1. `maakHeroBeeld`  — fal.ai (FLUX), tekst-naar-beeld. Puur sfeer: de kleding
 *     is verzonnen. Voor een banner waar geen product in hoeft.
 *  2. `maakHeroVanProduct` — FASHN product-to-model. Je geeft een ECHT artikel
 *     mee (de packshot) én een scène-omschrijving; FASHN bouwt de scène eromheen
 *     met dat artikel aan. Dit is de betere weg zodra de banner over een product
 *     gaat: wat je ziet is dan wat we verkopen, en dat is ook de huisregel
 *     (visuals = onze eigen producten, geen stock).
 *  3. `maakHeroVanBeeld` — fal.ai image-to-image op een beeld dat we AL hebben:
 *     een eerdere banner, een sfeerbeeld of een modelfoto (de outfit). Voor als
 *     het beeld goed is maar de omgeving niet — of om het ongewijzigd in de
 *     bannerbank te zetten. Bewust géén FASHN: zo'n bronbeeld is meestal zelf
 *     al gegenereerd, en dat als garment-input gebruiken is fictie op fictie.
 *
 * FASHN heeft dus wél een prompt — alleen geen lege start: er moet een product
 * als anker in. Zonder artikel kan het niets, met artikel kan het een straat,
 * atelier of bruiloft. Zie lib/lifestyle.ts, dat langs dezelfde weg de
 * sfeerbeelden per product maakt.
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

/**
 * FASHN werkt rond een model in beeld en gaat niet zo breed als FLUX: 21:9 zit
 * er niet in. 16:9 is het breedst dat een banner met een persoon erin nog
 * fatsoenlijk oplevert.
 */
export const HERO_ASPECTS_PRODUCT = ["16:9", "3:2", "4:3", "1:1", "4:5"] as const;

/**
 * Dezelfde thema's, maar dan als ALLEEN de scène — zonder de kleding erin. Bij
 * FASHN komt de kleding uit de packshot; zou de prompt ook nog een pak
 * beschrijven, dan gaat het model twee kanten op en verliest het artikel het.
 */
export const HERO_SCENES: Record<string, string> = {
  "peaky-blinders":
    "standing confident and brooding on a moody cobblestone industrial street at dusk, dramatic overcast light, atmospheric haze, cinematic vintage colour grade",
  "italiaanse-zomer":
    "leaning on a sun-bleached balustrade above a glittering Italian coastline, warm midday Mediterranean light, relaxed dolce-vita mood, vivid and bright",
  "gala-black-tie":
    "in a grand dimly-lit classical hall, warm chandelier glow, refined black-tie elegance, cinematic and moody",
  dandy:
    "against a richly coloured vintage interior with velvet and brass, warm directional light, characterful and elegant",
  "wedding-golden-hour":
    "laughing on the sun-drenched whitewashed steps of a Mediterranean coastal village at golden hour, the turquoise sea glittering behind him, relaxed and joyful",
  "city-editorial":
    "walking a sunlit historic European city street in the soft early morning, relaxed elegant stride, warm tones, candid and timeless",
  "atelier-tailor":
    "in a refined tailor's atelier bathed in warm window light, adjusting his cuff before a tall antique mirror, rolls of fine wool fabric softly out of focus",
  "terrace-aperitivo":
    "relaxing at a sunlit Italian terrace cafe, glass raised in a warm toast, colourful old-town facades behind, lively golden-hour light",
  "business-portrait":
    "standing calm and confident in a bright modern interior with soft daylight, understated luxury, clean refined composition",
  "autumn-knitwear":
    "walking a misty tree-lined lane in soft overcast light, warm earthy tones, refined countryside elegance",
  "landing-zakelijk":
    "in a bright modern glass-walled office boardroom, professional and approachable, soft clean daylight, plenty of space on the left for a headline",
  "landing-students":
    "raising a toast at an elegant candle-lit student-society gala dinner, celebratory and warm, golden ambient light, characterful and joyful",
  "landing-etiquette":
    "in a refined classic interior, warm soft directional light, attention on the details of the outfit, elegant and timeless",
};

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

/* ── Weg 2: hero MÉT een echt artikel (FASHN product-to-model) ───────────── */

const FASHN_API = "https://api.fashn.ai/v1";

/**
 * Merk- en stijlregels voor de product-weg. Kort gehouden: de scène en het
 * artikel vullen de prompt al, en hoe langer de prompt, hoe minder gewicht het
 * echte artikel krijgt. "must stay accurate to the reference photo" staat er
 * bewust in — zonder die zin gaat FASHN het kledingstuk hertekenen.
 */
const HERO_STYLE_PRODUCT =
  "Editorial menswear campaign photograph for an upscale men's formalwear brand, photorealistic and elegant, natural light, subtle film grain, generous negative space for a headline. A crisp collared dress shirt under the jacket — never a t-shirt. If a waistcoat is shown, its bottom button is left open. No text, no logo, no watermark anywhere in the image. The shown product must stay accurate to the reference photo.";

/** Hoe je het artikel benoemt, per hoofdgroep. Spiegelt lib/model-photo.ts. */
function draagtekstVoor(hoofdgroep: string): string {
  switch (hoofdgroep) {
    case "Pakken": return "wearing THIS suit with a crisp white dress shirt and brown leather shoes";
    case "Colberts": return "wearing THIS blazer over a crisp white dress shirt, with matching trousers";
    case "Gilets": return "wearing THIS waistcoat over a crisp white dress shirt, with matching trousers";
    case "Broeken": return "wearing THESE trousers with a tucked crisp white shirt and leather shoes";
    case "Overhemden": return "wearing THIS shirt, neatly styled with tailored trousers";
    case "Truien": case "Vesten": return "wearing THIS knitwear over a shirt collar, with tailored trousers";
    case "Polo-shirts": return "wearing THIS polo shirt, styled with tailored trousers";
    case "Jassen": return "wearing THIS coat over neat menswear, with trousers and leather shoes";
    case "Schoenen": return "wearing THESE shoes with a tailored suit and a crisp white shirt";
    case "Dassen": case "Stropdassen": return "wearing THIS tie with a tailored suit and a crisp white shirt";
    default: return "wearing THIS item, neatly styled with tailored menswear";
  }
}

/** Start een FASHN-run en wacht op het resultaat (kan minuten duren). */
async function fashnProductToModel(productImage: string, prompt: string, aspect: string): Promise<string | null> {
  const key = process.env.FASHN_API_KEY || "";
  if (!key) throw new Error("FASHN_API_KEY ontbreekt.");
  const start = await fetch(`${FASHN_API}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model_name: "product-to-model",
      inputs: { product_image: productImage, prompt, output_format: "jpeg", aspect_ratio: aspect },
    }),
  });
  if (!start.ok) throw new Error(`FASHN ${start.status}: ${(await start.text()).slice(0, 200)}`);
  const { id } = (await start.json()) as { id?: string };
  if (!id) throw new Error("FASHN gaf geen run-id terug.");

  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const st = await fetch(`${FASHN_API}/status/${id}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!st.ok) continue;
    const j = (await st.json()) as { status?: string; output?: string[]; error?: unknown };
    if (j.status === "completed" && j.output?.[0]) return j.output[0];
    if (j.status === "failed") throw new Error(`FASHN mislukt: ${String(j.error || "onbekende fout").slice(0, 160)}`);
  }
  throw new Error("FASHN duurde te lang.");
}

/** Shopify levert standaard een verkleinde variant; wij willen het origineel. */
function volleResolutie(url: string): string {
  return String(url || "").replace(/_(\d+)x(\d+)?(_crop_[a-z]+)?(?=\.[a-z]+(\?|$))/i, "");
}

export type HeroProductBron = { handle: string; titel: string; hoofdgroep: string; packshot: string };

/**
 * Maakt een banner MET een echt artikel erin. `thema` kiest de scène uit
 * HERO_SCENES, `prompt` overschrijft die met een eigen scène-omschrijving.
 *
 * De aanroeper levert het product (handle + packshot + hoofdgroep) aan, zodat
 * deze functie niets van de database hoeft te weten en ook vanuit een script
 * bruikbaar blijft.
 */
export async function maakHeroVanProduct(
  bron: HeroProductBron,
  opts: { thema?: string; prompt?: string; aspect?: string; naam?: string } = {},
): Promise<HeroBeeld> {
  if (!bron.packshot) throw new Error("Dit product heeft geen productfoto om op te baseren.");

  const scene = (opts.prompt || "").trim() || HERO_SCENES[opts.thema || ""] || "";
  if (!scene) throw new Error("Geen thema of scène-omschrijving opgegeven.");

  const aspect = (HERO_ASPECTS_PRODUCT as readonly string[]).includes(opts.aspect || "")
    ? (opts.aspect as string)
    : "16:9";

  const basis =
    slugify(opts.naam || `${opts.thema || "hero"}-${bron.handle}`) || `hero-${slugify(bron.handle)}`;
  const bestaand = new Set((await listHeroBeelden()).map((b) => b.slug));
  let slug = basis;
  for (let n = 2; bestaand.has(slug) && n < 100; n++) slug = `${basis}-${n}`;

  const prompt = `A man ${draagtekstVoor(bron.hoofdgroep)}, ${scene}. ${HERO_STYLE_PRODUCT}`;
  const out = await fashnProductToModel(volleResolutie(bron.packshot), prompt, aspect);
  if (!out) throw new Error("FASHN gaf geen beeld terug.");
  const url = await bewaarHeroBeeld(out, slug);

  return {
    slug,
    label: `${bron.titel} — ${HERO_THEMAS.find((h) => h.slug === opts.thema)?.label || "eigen scène"}`,
    url,
    thema: opts.thema || "",
    aspect,
    gemaaktOp: new Date().toISOString(),
    bytes: 0,
  };
}

/* ── Weg 3: hero VAN een bestaand beeld (fal.ai image-to-image) ──────────── */

/**
 * Zelfde endpoint als de staalfoto-modus van de packshot-tool (lib/packshot.ts),
 * dus geen nieuwe dienst en geen nieuwe sleutel: `FAL_KEY` volstaat.
 */
export const HERO_IMG2IMG_MODEL = process.env.FAL_HERO_IMG2IMG_MODEL || "fal-ai/flux/dev/image-to-image";

/**
 * Hoeveel het bronbeeld mag veranderen (0 = niets, 1 = alles opnieuw). 0,45 laat
 * de outfit en de houding herkenbaar en herschildert vooral de omgeving en het
 * licht. Hoger dan ~0,7 en je bent het pak kwijt dat je juist wilde laten zien.
 */
const HERO_STERKTE = 0.45;

/**
 * Merkregels voor deze weg. Bewust kort én met een expliciete "verander de
 * kleding niet"-zin: het bronbeeld is meestal al een modelfoto of sfeerbeeld
 * met ons artikel erop, en dát moet blijven staan — anders verzint FLUX er een
 * ander pak omheen en kijk je naar iets dat we niet verkopen.
 */
const HERO_STYLE_BEELD =
  "Keep the person, the pose and above all the clothing exactly as in the source photo — do not restyle, recolour or replace any garment. Editorial menswear campaign photograph for an upscale men's formalwear brand, photorealistic and elegant, subtle film grain, generous negative space for a headline. No text, no logo, no watermark anywhere in the image.";

async function falVanBeeld(imageUrl: string, prompt: string, sterkte: number): Promise<string | null> {
  const key = process.env.FAL_KEY || process.env.FAL_API_KEY || "";
  if (!key) throw new Error("FAL_KEY ontbreekt.");
  const res = await fetch(`https://fal.run/${HERO_IMG2IMG_MODEL}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: imageUrl,
      prompt: `${prompt} ${HERO_STYLE_BEELD}`,
      strength: sterkte,
      num_images: 1,
      output_format: "jpeg",
      enable_safety_checker: true,
    }),
  });
  if (!res.ok) throw new Error(`fal ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { images?: { url?: string }[] };
  return j?.images?.[0]?.url || null;
}

export type HeroBeeldBron = { url: string; label: string };

/**
 * Maakt een banner VAN een beeld dat we al hebben: een eerder gemaakte banner,
 * een sfeerbeeld, of een modelfoto (de outfit). Twee smaken:
 *
 *  - `hergebruik` — het beeld ongewijzigd in de bannerbank zetten. Kost niets
 *    en verandert niets; voor als het beeld al goed is en je het alleen als
 *    banner wilt kunnen kiezen.
 *  - anders — fal.ai herschildert de omgeving rond het beeld met de gekozen
 *    scène. Het bronbeeld blijft leidend (strength 0,45), dus de outfit die
 *    erop staat blijft staan.
 *
 * Let op: image-to-image levert de verhouding van het BRONBEELD. Een 4:5
 * modelfoto wordt dus geen 21:9 banner — daarvoor is de product-weg (FASHN,
 * met aspect_ratio) of een nieuw sfeerbeeld de juiste keuze.
 */
export async function maakHeroVanBeeld(
  bron: HeroBeeldBron,
  opts: { thema?: string; prompt?: string; naam?: string; hergebruik?: boolean } = {},
): Promise<HeroBeeld> {
  const src = (bron.url || "").trim();
  if (!/^https?:\/\//i.test(src)) throw new Error("Geen geldig bronbeeld opgegeven.");

  const basis =
    slugify(opts.naam || `${opts.thema || "hero"}-${bron.label || "beeld"}`) || "hero-uit-beeld";
  const bestaand = new Set((await listHeroBeelden()).map((b) => b.slug));
  let slug = basis;
  for (let n = 2; bestaand.has(slug) && n < 100; n++) slug = `${basis}-${n}`;

  let out = volleResolutie(src);
  if (!opts.hergebruik) {
    const scene = (opts.prompt || "").trim() || HERO_SCENES[opts.thema || ""] || "";
    if (!scene) throw new Error("Geen thema of scène-omschrijving opgegeven.");
    const gemaakt = await falVanBeeld(out, scene, HERO_STERKTE);
    if (!gemaakt) throw new Error("fal.ai gaf geen beeld terug.");
    out = gemaakt;
  }
  const url = await bewaarHeroBeeld(out, slug);

  return {
    slug,
    label: opts.hergebruik
      ? `${bron.label || "Uit de beeldbank"} — overgenomen`
      : `${bron.label || "Uit de beeldbank"} — ${HERO_THEMAS.find((h) => h.slug === opts.thema)?.label || "eigen scène"}`,
    url,
    thema: opts.thema || "",
    /* De verhouding komt uit het bronbeeld en die kennen we hier niet; leeg
       laten is eerlijker dan een aspect verzinnen dat de kiezer dan toont. */
    aspect: "",
    gemaaktOp: new Date().toISOString(),
    bytes: 0,
  };
}
