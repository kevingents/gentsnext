import { put, del } from "@vercel/blob";
import sharp from "sharp";

/**
 * AI-packshot uit tekst: voor producten ZONDER bronfoto (bv. "teFotograferen"
 * uit de Fotostatus-tool). Pijplijn: FLUX flat-lay (product-only) → bg-removal
 * (BiRefNet) → composiet op PUUR WIT, in jullie packshot-stijl. Het is een
 * AI-benadering, géén echte studiofoto — markeer als zodanig.
 */

const FAL = "https://fal.run";

const TYPE_EN: Record<string, string> = {
  Broeken: "tailored trousers", Overhemden: "dress shirt", Pakken: "two-piece suit",
  Colberts: "blazer jacket", Truien: "knitted sweater", "Polo-shirts": "polo shirt",
  Gilets: "waistcoat", Stropdassen: "silk necktie", Strikken: "bow tie",
  Schoenen: "leather shoes", "T-Shirts": "t-shirt", Vesten: "cardigan", Jassen: "coat",
};

const TYPE_FROM_TITLE: [RegExp, string][] = [
  [/pantalon|chino|broek|jeans|short|bermuda/i, "tailored trousers"],
  [/polo/i, "polo shirt"],
  [/t-?shirt/i, "t-shirt"],
  [/overhemd|\bshirt\b|blouse/i, "dress shirt"],
  [/trui|sweater|pullover|knit|coltrui|turtle/i, "knitted sweater"],
  [/vest|cardigan/i, "cardigan"],
  [/colbert|blazer|jasje/i, "blazer jacket"],
  [/smoking|kostuum|\bpak\b|rokkostuum/i, "two-piece suit"],
  [/gilet|waistcoat|rokvest/i, "waistcoat"],
  [/strik\b|bow/i, "bow tie"],
  [/stropdas|\bdas\b|necktie|\btie\b/i, "silk necktie"],
  [/jas|coat|mantel|parka|trench/i, "coat"],
  [/schoen|loafer|sneaker|veter|boot|derby|brogue/i, "leather shoes"],
  [/riem|belt/i, "leather belt"],
  [/\bsok|sock/i, "socks"],
];

const COLOR_RE =
  /strandzand|zand|lichtblauw|donkerblauw|kobalt|navy|blauw|antraciet|grijs|zwart|wit|ecru|cr[eè]me|bruin|cognac|camel|taupe|beige|olijf|groen|jade|mos|bordeaux|wijnrood|steenrood|terracotta|rood|roze|koraal|zalm|paars|mauve/i;

export function inferType(title: string, hoofdgroep?: string | null): string {
  for (const [re, t] of TYPE_FROM_TITLE) if (re.test(title)) return t;
  return (hoofdgroep && TYPE_EN[hoofdgroep]) || "premium menswear item";
}

function slug(s: string): string {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "packshot";
}

async function flux(prompt: string, key: string): Promise<Buffer | null> {
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await fetch(`${FAL}/fal-ai/flux-pro/v1.1-ultra`, {
        method: "POST", headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, aspect_ratio: "3:4", num_images: 1, output_format: "jpeg", safety_tolerance: "5" }),
      });
      if (res.ok) {
        const j = await res.json();
        const u = j?.images?.[0]?.url || j?.image?.url;
        if (!u) return null;
        const r = await fetch(u);
        return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      }
      if (res.status === 429 || res.status >= 500) { await new Promise((s) => setTimeout(s, 2500 * a)); continue; }
      return null;
    } catch { await new Promise((s) => setTimeout(s, 2500 * a)); }
  }
  return null;
}

/** Knip product uit (BiRefNet) en zet 't op puur wit, net 3:4 met marge. */
async function whiten(imageUrl: string, key: string): Promise<Buffer | null> {
  let cutUrl: string | null = null;
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(`${FAL}/fal-ai/birefnet`, {
        method: "POST", headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: imageUrl }),
      });
      if (r.ok) { const j = await r.json(); cutUrl = j?.image?.url || j?.images?.[0]?.url || null; break; }
      if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 2000 * a)); continue; }
      return null;
    } catch { await new Promise((s) => setTimeout(s, 2000 * a)); }
  }
  if (!cutUrl) return null;
  const cr = await fetch(cutUrl);
  if (!cr.ok) return null;
  const png = Buffer.from(await cr.arrayBuffer());
  const trimmed = await sharp(png).trim().png().toBuffer().catch(() => png);
  const m = await sharp(trimmed).metadata();
  const w = m.width || 0, h = m.height || 0;
  if (!w || !h) return null;
  const FILL = 0.86, TARGET = 3 / 4;
  let ch = Math.round(h / FILL); let cw = Math.round(ch * TARGET);
  if (cw < Math.round(w / FILL)) { cw = Math.round(w / FILL); ch = Math.round(cw / TARGET); }
  return sharp({ create: { width: cw, height: ch, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: trimmed, gravity: "center" }]).jpeg({ quality: 92 }).toBuffer();
}

export interface PackshotInput {
  title: string;
  color?: string | null;
  hoofdgroep?: string | null;
  /** Bestandsnaam-basis (bv. productNr); anders uit de titel. */
  ref?: string | null;
}

export async function generatePackshot(input: PackshotInput): Promise<{ ok: true; url: string; prompt: string } | { ok: false; error: string }> {
  const key = process.env.FAL_KEY || "";
  const token = (process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN) || "";
  if (!key) return { ok: false, error: "FAL_KEY ontbreekt in gentsnext." };
  if (!token) return { ok: false, error: "Blob-token ontbreekt." };

  const title = String(input.title || "").trim();
  if (!title) return { ok: false, error: "Titel ontbreekt." };
  const type = inferType(title, input.hoofdgroep);
  const color = (input.color || (title.match(COLOR_RE) || [])[0] || "").trim();

  const prompt =
    `Top-down flat-lay product photograph of a single men's ${type}` +
    (color ? ` in ${color}` : "") + ", " +
    `neatly laid out flat and straight (full length), centered on a clean seamless PURE WHITE studio background (#FFFFFF), only a very subtle soft shadow. ` +
    `The garment: ${title}. ` +
    `Isolated garment ONLY — absolutely no person, no model, no body, no legs, no mannequin, no hands, no face, nothing else in the frame. ` +
    `Premium menswear e-commerce packshot on white, soft even diffused studio lighting, true-to-life accurate colour, crisp sharp focus, fine fabric and stitching detail, photorealistic.`;

  const raw = await flux(prompt, key);
  if (!raw) return { ok: false, error: "FLUX-generatie mislukt." };
  const tmpUrl = await uploadTmp(raw, token);
  const white = (await whiten(tmpUrl, key)) || raw;
  await del(tmpUrl, { token }).catch(() => {}); // tijdelijke FLUX-upload opruimen

  const name = slug(input.ref || title);
  try {
    const b = await put(`ai-packshots/${name}.jpg`, white, { access: "public", token, contentType: "image/jpeg", allowOverwrite: true });
    return { ok: true, url: `${b.url}?v=${Date.now()}`, prompt };
  } catch (e) {
    return { ok: false, error: `Opslaan mislukt: ${(e as Error).message}` };
  }
}

/** BiRefNet heeft een URL nodig; zet de FLUX-jpeg eerst op blob. */
async function uploadTmp(buf: Buffer, token: string): Promise<string> {
  const b = await put(`ai-packshots/_tmp/${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`, buf, { access: "public", token, contentType: "image/jpeg", allowOverwrite: true });
  return b.url;
}
