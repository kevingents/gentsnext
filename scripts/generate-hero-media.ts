import "@/lib/load-env";
import { put } from "@vercel/blob";

/**
 * Hero-/sfeerbeelden vanaf nul met fal.ai (FLUX). Voor merk-banners — NIET voor
 * productweergave (daarvoor blijft FASHN + onze echte producten gelden).
 *
 * Stijl: editoriale herenmode-campagne, getailleerde pakken + wit overhemd (nooit
 * een T-shirt onder een colbert), warm/filmisch, verfijnde settings. GEEN tekst of
 * logo in het beeld — de GENTS-wordmark komt apart als echte overlay.
 *
 *   FAL_KEY in .env.local zetten, dan:
 *   npx tsx scripts/generate-hero-media.ts            (alle hero's, 1 beeld elk)
 *   npx tsx scripts/generate-hero-media.ts wedding    (alleen slugs die 'wedding' bevatten)
 *   npx tsx scripts/generate-hero-media.ts "" 2       (2 varianten per hero)
 */

const MODEL = process.env.FAL_HERO_MODEL || "fal-ai/flux-pro/v1.1-ultra";

// Kwaliteits-/merkcues, neutraal qua licht zodat elk thema z'n eigen sfeer kan zetten.
const STYLE =
  "Editorial menswear campaign photograph for an upscale, refined men's formalwear brand — aspirational yet wearable. Impeccably tailored suits worn over a crisp collared dress shirt — never a t-shirt under a jacket. Photorealistic high-end fashion photography, sharp and elegant, subtle film grain, generous negative space for a headline. Absolutely no text, no logo, no watermark, no caption anywhere in the image.";

type Hero = { slug: string; aspect: string; prompt: string };

const HEROES: Hero[] = [
  // — Thema's —
  { slug: "peaky-blinders", aspect: "21:9",
    prompt: "Three sharply dressed men in 1920s-style tweed and herringbone three-piece suits with buttoned waistcoats, ties and flat caps, standing confident and brooding on a moody cobblestone industrial street at dusk, dramatic overcast light, atmospheric haze, cinematic vintage colour grade." },
  { slug: "italiaanse-zomer", aspect: "21:9",
    prompt: "An effortlessly elegant man in a light linen summer suit and loafers leaning on a sun-bleached balustrade above a glittering Italian coastline, warm midday Mediterranean light, relaxed dolce-vita mood, vivid and bright." },
  { slug: "gala-black-tie", aspect: "21:9",
    prompt: "A distinguished man in an impeccable black tuxedo with a black bow tie and white dress shirt in a grand dimly-lit classical hall, warm chandelier glow, refined black-tie elegance, cinematic and moody." },
  { slug: "dandy", aspect: "16:9",
    prompt: "A stylish modern dandy in a bold patterned three-piece suit with a pocket square and confident flair, against a richly coloured vintage interior with velvet and brass, warm directional light, characterful and elegant." },
  // — Algemeen / gelegenheid —
  { slug: "wedding-golden-hour", aspect: "21:9",
    prompt: "Two stylish male wedding guests in elegant light-toned suits laughing together on the sun-drenched whitewashed steps of a Mediterranean coastal village at golden hour, the turquoise sea glittering behind them, relaxed and joyful." },
  { slug: "city-editorial", aspect: "21:9",
    prompt: "A confident, well-dressed man in a sharp navy tailored suit walking a sunlit historic European city street in the soft early morning, relaxed elegant stride, warm tones, candid and timeless." },
  { slug: "atelier-tailor", aspect: "16:9",
    prompt: "A refined tailor's atelier bathed in warm window light; a man in a three-piece suit adjusts his cuff before a tall antique mirror, rolls of fine wool fabric and a measuring tape softly out of focus." },
  { slug: "terrace-aperitivo", aspect: "21:9",
    prompt: "A group of well-dressed men in smart summer suits relaxing at a sunlit Italian terrace cafe, glasses raised in a warm toast, colourful old-town facades behind, lively and elegant golden-hour light." },
  { slug: "business-portrait", aspect: "16:9",
    prompt: "A distinguished man in a charcoal business suit and white shirt standing calm and confident in a bright modern interior with soft daylight, understated luxury, clean refined composition." },
  { slug: "autumn-knitwear", aspect: "21:9",
    prompt: "A man in fine autumn knitwear over a shirt collar and tailored trousers walking a misty tree-lined lane in soft overcast light, warm earthy tones, refined countryside elegance." },
];

async function generate(prompt: string, aspect: string, key: string): Promise<string | null> {
  try {
    const res = await fetch(`https://fal.run/${MODEL}`, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: `${prompt} ${STYLE}`,
        aspect_ratio: aspect,
        num_images: 1,
        output_format: "jpeg",
        enable_safety_checker: true,
        safety_tolerance: "5",
      }),
    });
    if (!res.ok) { console.error("    fal-fout", res.status, (await res.text()).slice(0, 200)); return null; }
    const j = await res.json();
    return j?.images?.[0]?.url || null;
  } catch (e) {
    console.error("    fout:", String((e as Error)?.message || e).slice(0, 120));
    return null;
  }
}

async function toBlob(srcUrl: string, path: string, token: string): Promise<string | null> {
  try {
    const r = await fetch(srcUrl);
    if (!r.ok) return null;
    const blob = await put(path, await r.arrayBuffer(), { access: "public", token, contentType: "image/jpeg", allowOverwrite: true });
    return `${blob.url}?v=${Date.now()}`;
  } catch { return null; }
}

async function main() {
  const key = process.env.FAL_KEY || process.env.FAL_API_KEY || "";
  const token = (process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN)!;
  if (!key) { console.error("FAL_KEY ontbreekt in .env.local."); process.exit(1); }
  if (!token) { console.error("Blob-token ontbreekt."); process.exit(1); }

  const only = (process.argv[2] || "").trim().toLowerCase();
  const variants = Math.max(1, Math.min(4, Number(process.argv[3]) || 1));
  const list = HEROES.filter((h) => !only || h.slug.includes(only));
  console.log(`⏳ ${list.length} hero('s) · ${variants} variant(en) · model ${MODEL}`);

  for (const h of list) {
    for (let v = 0; v < variants; v++) {
      const label = variants > 1 ? `${h.slug}-${v + 1}` : h.slug;
      console.log(`• ${label} (${h.aspect})`);
      const url = await generate(h.prompt, h.aspect, key);
      if (!url) { console.log("   ✗ geen beeld"); continue; }
      const saved = await toBlob(url, `ai-hero/${label}.jpg`, token);
      console.log(saved ? `   ✓ ${saved}` : "   ✗ upload mislukt");
    }
  }
  console.log("\n✓ Klaar.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
