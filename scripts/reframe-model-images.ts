import "@/lib/load-env";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";

/**
 * Haalt de zichtbare "kader"/vignet weg uit de modelfoto's: trim de oude platte-
 * kleur-padding, herpad naar 4:5 met een VERVAAGDE cover-achtergrond van het beeld
 * zelf → naadloze studio-grijze zijkanten, geen rand meer. Géén FASHN-credits.
 *
 *   npx tsx scripts/reframe-model-images.ts          (alle model1+model2)
 *   npx tsx scripts/reframe-model-images.ts rok       (alleen handles met 'rok')
 */
const TARGET = 4 / 5;

async function reframe(buf: Buffer): Promise<Buffer | null> {
  const meta0 = await sharp(buf).metadata();
  const area0 = (meta0.width || 0) * (meta0.height || 0);
  const trimmed = await sharp(buf).trim({ threshold: 8 }).toBuffer().catch(() => buf);
  const m = await sharp(trimmed).metadata();
  const w = m.width || 0, h = m.height || 0;
  if (!w || !h) return null;
  if (w * h < area0 * 0.25) return null; // te veel weggetrimd → laat met rust
  let cw: number, ch: number;
  if (w / h < TARGET) { ch = h; cw = Math.round(h * TARGET); }
  else { cw = w; ch = Math.round(w / TARGET); }
  const bg = await sharp(trimmed).resize(cw, ch, { fit: "cover" }).blur(60).modulate({ brightness: 1.04 }).toBuffer();
  return sharp(bg).composite([{ input: trimmed, gravity: "center" }]).jpeg({ quality: 90 }).toBuffer();
}

async function main() {
  const token = (process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN)!;
  if (!token) { console.error("blob-token ontbreekt"); process.exit(1); }
  const db = getDb();
  const only = (process.argv[2] || "").trim();
  const filter = only ? `and handle ilike '%${only.replace(/'/g, "")}%'` : "";
  const rows = (await db.execute<{ id: string; handle: string; m1: string; m2: string }>(sql.raw(
    `select id, handle, model_image_url m1, model_image_url2 m2 from products
     where model_image_url <> '' ${filter} order by handle`,
  ))).rows;
  console.log(`⏳ ${rows.length} producten reframen…`);
  let done = 0, err = 0;
  for (const r of rows) {
    for (const [col, url] of [["modelImageUrl", r.m1], ["modelImageUrl2", r.m2]] as const) {
      if (!url) continue;
      try {
        const clean = url.split("?")[0];
        const path = new URL(clean).pathname.replace(/^\//, "");
        const res = await fetch(clean);
        if (!res.ok) { err++; continue; }
        const out = await reframe(Buffer.from(await res.arrayBuffer()));
        if (!out) continue;
        let saved = "";
        for (let a = 1; a <= 3 && !saved; a++) {
          try { const b = await put(path, out, { access: "public", token, contentType: "image/jpeg", allowOverwrite: true }); saved = `${b.url}?v=${Date.now()}`; }
          catch { await new Promise((rr) => setTimeout(rr, 1500 * a)); }
        }
        if (!saved) { err++; continue; }
        for (let a = 1; a <= 3; a++) { try { await db.update(products).set({ [col]: saved } as Record<string, string>).where(eq(products.id, r.id)); break; } catch { await new Promise((rr) => setTimeout(rr, 1500 * a)); } }
      } catch { err++; }
    }
    done++;
    if (done % 25 === 0) console.log(`  …${done}/${rows.length}`);
  }
  console.log(`\n✓ Klaar — ${done} producten, ${err} fout.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
