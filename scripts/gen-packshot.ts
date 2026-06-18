import "@/lib/load-env";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import sharp from "sharp";

/**
 * EXPERIMENT: maak een packshot voor een product ZONDER bronfoto, puur uit
 * titel + omschrijving + velden (FAL/FLUX text-to-image). Dit is een AI-benadering,
 * GEEN echte productfoto — bedoeld als stopgap voor nieuwe artikelen die nog geen
 * beeld hebben. Update de DB NIET; print alleen de prompt + de blob-URL ter
 * beoordeling.
 *
 *   npx tsx scripts/gen-packshot.ts <handle>
 */
const KEY = process.env.FAL_KEY || "";

const TYPE_EN: Record<string, string> = {
  Broeken: "tailored trousers", Overhemden: "dress shirt", Pakken: "two-piece suit",
  Colberts: "blazer jacket", Truien: "knitted sweater", "Polo-shirts": "polo shirt",
  Gilets: "waistcoat", Stropdassen: "silk necktie", Strikken: "bow tie",
  Schoenen: "leather shoes", "T-Shirts": "t-shirt", Vesten: "cardigan", Jassen: "coat",
};

function stripHtml(s: string): string {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

async function flux(prompt: string): Promise<Buffer | null> {
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await fetch("https://fal.run/fal-ai/flux-pro/v1.1-ultra", {
        method: "POST",
        headers: { Authorization: `Key ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, aspect_ratio: "3:4", num_images: 1, output_format: "jpeg", safety_tolerance: "5" }),
      });
      if (res.ok) {
        const j = await res.json();
        const u = j?.images?.[0]?.url || j?.image?.url;
        if (!u) return null;
        const r = await fetch(u);
        return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      }
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2500 * a)); continue; }
      console.error("FAL", res.status, (await res.text()).slice(0, 200));
      return null;
    } catch (e) { await new Promise((r) => setTimeout(r, 2500 * a)); }
  }
  return null;
}

async function main() {
  if (!KEY) { console.error("FAL_KEY ontbreekt"); process.exit(1); }
  const token = (process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN)!;
  const handle = (process.argv[2] || "pantalon-stretchkatoen-zand-copy").trim();

  const db = getDb();
  const p = (await db.execute<{ title: string; desc: string; hg: string; sub: string; mat: string; kleur: string; extra: string }>(sql`
    select p.title,
      left(regexp_replace(coalesce(p.description_html,''),'<[^>]+>',' ','g'),300) desc,
      p.attributes->>'hoofdgroep_omschrijving' hg, p.attributes->>'subgroep' sub,
      coalesce(p.attributes->>'samenstelling_materiaal', p.attributes->>'materiaal') mat,
      p.attributes->>'kleur' kleur,
      coalesce(p.attributes->>'omschrijving_bol', p.attributes->>'long_deescription','') extra
    from products p where p.handle=${handle} limit 1`)).rows[0];
  if (!p) { console.error("Product niet gevonden:", handle); process.exit(1); }

  const cleanTitle = p.title.replace(/\s*\(copy\)\s*/i, "").trim();
  const type = TYPE_EN[p.hg] || p.sub || "menswear garment";
  const colorWord = (p.title.match(/zand|strandzand|lichtblauw|donkerblauw|kobalt|navy|blauw|antraciet|grijs|zwart|wit|ecru|creme|bruin|cognac|camel|taupe|beige|olijf|groen|jade|mos|bordeaux|wijnrood|rood|steenrood|terracotta|roze|koraal|zalm|paars|mauve/i) || [])[0] || "";
  const color = (p.kleur || colorWord).trim();
  const material = (p.mat || "").trim();
  const details = stripHtml(p.extra).slice(0, 260);

  const prompt =
    `Top-down flat-lay product photograph of a single men's ${type}` +
    (color ? ` in ${color}` : "") + (material ? ` (${material})` : "") + ", " +
    `neatly folded / laid out flat and centered on a clean seamless PURE WHITE studio background (#FFFFFF, bright e-commerce white), ` +
    `with only a very subtle soft shadow. ` +
    `The garment: ${cleanTitle}. ${details} ` +
    `Isolated garment ONLY — absolutely no person, no model, no body, no legs, no mannequin, no hands, no face, nothing else in the frame. ` +
    `Premium menswear e-commerce packshot in the style of a clean folded catalogue product shot on white, soft even diffused studio lighting, ` +
    `true-to-life accurate colour, crisp sharp focus, fine fabric and stitching detail, photorealistic.`;

  console.log("HANDLE:", handle);
  console.log("PROMPT:\n", prompt, "\n");
  console.log("⏳ FLUX genereren…");
  const img = await flux(prompt);
  if (!img) { console.error("Genereren mislukt."); process.exit(1); }
  const b = await put(`ai-packshots/${handle}.jpg`, img, { access: "public", token, contentType: "image/jpeg", allowOverwrite: true });
  console.log("\n✓ FLUX-packshot:", `${b.url}?v=${Date.now()}`);

  // GENTS-stijl forceren: product uitknippen + op puur wit zetten (zoals de echte packshots).
  console.log("⏳ Op puur wit zetten (bg-removal)…");
  const white = await whiten(b.url);
  if (white) {
    const bw = await put(`ai-packshots/${handle}-white.jpg`, white, { access: "public", token, contentType: "image/jpeg", allowOverwrite: true });
    console.log("✓ Packshot op WIT (GENTS-stijl):", `${bw.url}?v=${Date.now()}`);
  } else {
    console.log("(bg-removal mislukt — gebruik de FLUX-versie hierboven)");
  }
  process.exit(0);
}

/** Knipt het product uit (fal.ai BiRefNet) en zet 't op puur wit, net 3:4 met marge. */
async function whiten(imageUrl: string): Promise<Buffer | null> {
  let cutUrl: string | null = null;
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch("https://fal.run/fal-ai/birefnet", {
        method: "POST", headers: { Authorization: `Key ${KEY}`, "Content-Type": "application/json" },
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
main().catch((e) => { console.error(e); process.exit(1); });
