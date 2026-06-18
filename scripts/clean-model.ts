import sharp from "sharp";

/**
 * Gedeelde helper voor de generators: model uitknippen (fal.ai BiRefNet) en
 * netjes inkaderen op de ÉGALE achtergrond die de site overal gebruikt
 * (`surface` = #F6F5F2, warme off-white) — zó dat nieuwe modelfoto's meteen in
 * het juiste formaat staan: schoon 4:5, model met nette marge (niet tegen de
 * rand), consistent met de echte packshots ernaast in het PLP-grid. Retourneert
 * null als bg-removal faalt (dan valt de generator terug op padding).
 */
const BG = { r: 246, g: 245, b: 242 }; // #F6F5F2 — site 'surface', de achtergrond die we altijd gebruiken
const TARGET = 4 / 5; // PDP-gallery is 4:5; PLP-kaart 3:4 croppt dit netjes met object-cover
const FILL = 0.9; // model vult ~90% van de bindende as → ~5% nette marge rondom

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

/**
 * Knipt de bg-removed PNG bij tot de persoon-bbox en zet 'm met nette marge,
 * gecentreerd, op een égale 4:5 #F6F5F2-achtergrond. Gedeeld door cleanModelTo45
 * (nieuwe generatie) en clean-model-bg.ts (batch-herstel van bestaande beelden).
 */
export async function frameCutoutTo45(cut: Buffer): Promise<Buffer | null> {
  // Trim de transparante rand weg → de echte persoon-bbox, voor strakke kadering.
  const trimmed = await sharp(cut).trim().png().toBuffer().catch(() => cut);
  const m = await sharp(trimmed).metadata();
  const w = m.width || 0, h = m.height || 0;
  if (!w || !h) return null;
  // 4:5-canvas met ~5% marge: standaard hoogte-gebonden; brede pose → breedte-gebonden.
  let ch = Math.round(h / FILL);
  let cw = Math.round(ch * TARGET);
  if (cw < Math.round(w / FILL)) { cw = Math.round(w / FILL); ch = Math.round(cw / TARGET); }
  return sharp({ create: { width: cw, height: ch, channels: 3, background: BG } })
    .composite([{ input: trimmed, gravity: "center" }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** Schone 4:5-modelfoto via bg-removal. null = mislukt (val terug op padding). */
export async function cleanModelTo45(imageUrl: string, falKey: string): Promise<Buffer | null> {
  if (!falKey) return null;
  const cut = await cutout(imageUrl, falKey);
  if (!cut) return null;
  return frameCutoutTo45(cut);
}
