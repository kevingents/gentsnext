import "@/lib/load-env";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";

/**
 * Normaliseert alle bestaande model-foto's naar exact 4:5, zodat ze de 4:5-galerij-
 * tegel (object-contain) naadloos vullen — geen cream "kader" meer. Idempotent: een
 * foto die al 4:5 is wordt overgeslagen. Padt met de hoek-achtergrondkleur (studio-
 * grijs) zodat het naadloos uitloopt. Géén FASHN-credits — puur sharp + blob.
 *
 *   npx tsx scripts/repad-model-images.ts
 */

const TARGET = 4 / 5;

async function padTo45(buf: Buffer): Promise<Buffer | null> {
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 0, h = meta.height ?? 0;
  if (!w || !h) return null;
  const ratio = w / h;
  if (Math.abs(ratio - TARGET) < 0.01) return null; // al 4:5
  // Gemiddelde van een rand-strook als achtergrond → blendt beter dan één hoekpixel.
  const stripe = ratio < TARGET
    ? await sharp(buf).extract({ left: 0, top: 0, width: Math.max(2, Math.floor(w * 0.04)), height: h }).stats()
    : await sharp(buf).extract({ left: 0, top: 0, width: w, height: Math.max(2, Math.floor(h * 0.04)) }).stats();
  const background = { r: Math.round(stripe.channels[0].mean), g: Math.round(stripe.channels[1].mean), b: Math.round(stripe.channels[2].mean), alpha: 1 };
  if (ratio < TARGET) {
    const tw = Math.round(h * TARGET); const left = Math.floor((tw - w) / 2);
    return sharp(buf).extend({ left, right: tw - w - left, background }).jpeg({ quality: 90 }).toBuffer();
  }
  const th = Math.round(w / TARGET); const top = Math.floor((th - h) / 2);
  return sharp(buf).extend({ top, bottom: th - h - top, background }).jpeg({ quality: 90 }).toBuffer();
}

async function main() {
  const token = (process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN)!;
  if (!token) { console.error("blob-token ontbreekt"); process.exit(1); }
  const db = getDb();
  const only = (process.argv[2] || "").trim(); // optioneel: alleen handles die dit bevatten (test)
  const filter = only ? `and handle ilike '%${only.replace(/'/g, "")}%'` : "";
  const rows = (await db.execute<{ id: string; handle: string; u: string }>(sql.raw(
    `select id, handle, model_image_url u from products where model_image_url <> '' ${filter} order by handle`,
  ))).rows;
  console.log(`⏳ ${rows.length} modelfoto's controleren…`);
  let fixed = 0, ok = 0, err = 0;
  for (const r of rows) {
    try {
      const clean = r.u.split("?")[0];
      const path = new URL(clean).pathname.replace(/^\//, "");
      const res = await fetch(clean);
      if (!res.ok) { err++; console.log(`  ✗ ${r.handle} (fetch ${res.status})`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const padded = await padTo45(buf);
      if (!padded) { ok++; continue; } // al 4:5
      let saved = "";
      for (let a = 1; a <= 3 && !saved; a++) {
        try { const b = await put(path, padded, { access: "public", token, contentType: "image/jpeg", allowOverwrite: true }); saved = `${b.url}?v=${Date.now()}`; }
        catch { await new Promise((rr) => setTimeout(rr, 1500 * a)); }
      }
      if (!saved) { err++; console.log(`  ✗ ${r.handle} (upload)`); continue; }
      for (let a = 1; a <= 3; a++) { try { await db.update(products).set({ modelImageUrl: saved }).where(eq(products.id, r.id)); break; } catch { await new Promise((rr) => setTimeout(rr, 1500 * a)); } }
      fixed++; console.log(`  ✓ ${r.handle} → 4:5`);
    } catch (e) { err++; console.log(`  ✗ ${r.handle}: ${String((e as Error).message).slice(0, 60)}`); }
  }
  console.log(`\n✓ Klaar — ${fixed} bijgepad, ${ok} al 4:5, ${err} fout.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
