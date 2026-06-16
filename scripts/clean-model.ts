import sharp from "sharp";

/**
 * Gedeelde helper voor de generators: model uitknippen (fal.ai BiRefNet) en op een
 * ÉGALE lichte studio-achtergrond in net 4:5 zetten — zo komen nieuwe modelfoto's
 * meteen in het juiste formaat zonder vignet/kader. Retourneert null als bg-removal
 * faalt (dan kan de generator terugvallen op padding).
 */
const BG = { r: 239, g: 238, b: 235 };
const TARGET = 4 / 5;

async function cutout(imageUrl: string, key: string): Promise<Buffer | null> {
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await fetch("https://fal.run/fal-ai/birefnet", {
        method: "POST",
        headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: imageUrl }),
      });
      if (res.ok) {
        const j = await res.json();
        const u = j?.image?.url || j?.images?.[0]?.url;
        if (!u) return null;
        const r = await fetch(u);
        return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      }
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * a)); continue; }
      return null;
    } catch { await new Promise((r) => setTimeout(r, 2000 * a)); }
  }
  return null;
}

/** Schone 4:5-modelfoto via bg-removal. null = mislukt (val terug op padding). */
export async function cleanModelTo45(imageUrl: string, falKey: string): Promise<Buffer | null> {
  if (!falKey) return null;
  const cut = await cutout(imageUrl, falKey);
  if (!cut) return null;
  const m = await sharp(cut).metadata();
  const w = m.width || 0, h = m.height || 0;
  if (!w || !h) return null;
  let cw: number, ch: number;
  if (w / h < TARGET) { ch = h; cw = Math.round(h * TARGET); }
  else { cw = w; ch = Math.round(w / TARGET); }
  return sharp({ create: { width: cw, height: ch, channels: 3, background: BG } })
    .composite([{ input: cut, gravity: "center" }])
    .jpeg({ quality: 92 })
    .toBuffer();
}
