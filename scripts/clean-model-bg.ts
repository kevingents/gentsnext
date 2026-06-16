import "@/lib/load-env";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";

/**
 * Definitieve fix voor de "kaders": knip het model uit met fal.ai (BiRefNet) en
 * zet het op een ÉGALE lichte studio-achtergrond, in net 4:5. Geen vignet/rand
 * meer, consistent over alle producten. Gebruikt FAL-credits (~$0,01–0,02/beeld).
 *
 *   npx tsx scripts/clean-model-bg.ts          (alle model1+model2)
 *   npx tsx scripts/clean-model-bg.ts smoking   (alleen handles met 'smoking')
 */
const KEY = process.env.FAL_KEY || "";
const BG = { r: 239, g: 238, b: 235 }; // schone zachte studio-lichtgrijs

async function cutout(imageUrl: string): Promise<string | null> {
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await fetch("https://fal.run/fal-ai/birefnet", {
        method: "POST",
        headers: { Authorization: `Key ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: imageUrl }),
      });
      if (res.ok) { const j = await res.json(); return j?.image?.url || j?.images?.[0]?.url || null; }
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * a)); continue; }
      return null;
    } catch { await new Promise((r) => setTimeout(r, 2000 * a)); }
  }
  return null;
}

async function clean(imageUrl: string): Promise<Buffer | null> {
  const cut = await cutout(imageUrl);
  if (!cut) return null;
  const res = await fetch(cut);
  if (!res.ok) return null;
  const png = Buffer.from(await res.arrayBuffer());
  const m = await sharp(png).metadata();
  const w = m.width || 998, h = m.height || 1248;
  return sharp({ create: { width: w, height: h, channels: 3, background: BG } })
    .composite([{ input: png, gravity: "center" }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function main() {
  const token = (process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN)!;
  if (!KEY) { console.error("FAL_KEY ontbreekt"); process.exit(1); }
  if (!token) { console.error("blob-token ontbreekt"); process.exit(1); }
  const db = getDb();
  const only = (process.argv[2] || "").trim();
  const filter = only ? `and handle ilike '%${only.replace(/'/g, "")}%'` : "";
  const rows = (await db.execute<{ id: string; handle: string; m1: string; m2: string }>(sql.raw(
    `select id, handle, model_image_url m1, model_image_url2 m2 from products
     where model_image_url <> '' ${filter} order by handle`,
  ))).rows;
  console.log(`⏳ ${rows.length} producten schoonmaken (fal.ai bg-removal)…`);
  let done = 0, err = 0;
  for (const r of rows) {
    for (const [col, url] of [["modelImageUrl", r.m1], ["modelImageUrl2", r.m2]] as const) {
      if (!url) continue;
      try {
        const clean1 = url.split("?")[0];
        const path = new URL(clean1).pathname.replace(/^\//, "");
        const out = await clean(clean1);
        if (!out) { err++; continue; }
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
    if (done % 20 === 0) console.log(`  …${done}/${rows.length} (${err} fout)`);
  }
  console.log(`\n✓ Klaar — ${done} producten, ${err} fout.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
