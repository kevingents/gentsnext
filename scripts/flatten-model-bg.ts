import "@/lib/load-env";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";

/**
 * Trekt de studio-achtergrond vlak: licht de vignet-randen op naar uniform licht
 * (linear 1.22, -16) zodat er geen zichtbaar "kader" meer in de modelfoto zit.
 * Pak blijft diep zwart, model natuurlijk. Géén FASHN-credits.
 *
 *   npx tsx scripts/flatten-model-bg.ts        (alle model1+model2)
 *   npx tsx scripts/flatten-model-bg.ts smoking
 */
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
  console.log(`⏳ ${rows.length} producten vlaktrekken…`);
  let done = 0, err = 0;
  for (const r of rows) {
    for (const [col, url] of [["modelImageUrl", r.m1], ["modelImageUrl2", r.m2]] as const) {
      if (!url) continue;
      try {
        const clean = url.split("?")[0];
        const path = new URL(clean).pathname.replace(/^\//, "");
        const res = await fetch(clean);
        if (!res.ok) { err++; continue; }
        const out = await sharp(Buffer.from(await res.arrayBuffer())).linear(1.22, -16).jpeg({ quality: 90 }).toBuffer();
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
