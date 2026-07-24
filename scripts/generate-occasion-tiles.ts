import "@/lib/load-env";
import { writeFileSync } from "node:fs";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import sharp from "sharp";

/**
 * Gelegenheden-tegels ("Waar kleed je je voor?" op home + /gelegenheden) in de
 * GENTS Zuid-Frankrijk-stijl (Kevin, 24 juli: "dit is niet onze zuid frankrijk
 * stijl" — de oude FLUX-tegels waren steriel: witte studio, kantoor, urn).
 * Via FASHN product-to-model met een ÉCHT GENTS-product per gelegenheid
 * (huisregel: visuals = onze eigen producten) → overschrijft de statische
 * public/brand/brand-impression-*.jpg (deploy = zichtbaar).
 *
 * Huisregels in de prompts: één mannelijk model solo, wit overhemd met kraag
 * onder het pak, uitvaart sober en respectvol (geen lach).
 *
 *   npm run gen:occasion-tiles
 */

const API = "https://api.fashn.ai/v1";

const BASE =
  "One single adult man, alone (strictly no partner, no couple, no group). He wears THIS exact suit from the reference photo with a crisp white dress shirt with a collar underneath. The shown product must stay accurate to the reference photo. Authentic warm editorial photo, natural real skin texture, shot on 35mm film with subtle grain — not glossy, not airbrushed. Full-length, cinematic composition with space around the subject.";

const TILES: Array<{
  file: string;
  label: string;
  productSql: ReturnType<typeof sql>;
  scene: string;
}> = [
  {
    file: "brand-impression-wedding.jpg",
    label: "Bruiloft",
    productSql: sql`
      select pi.url from products p
      join product_collections cp on cp.product_id = p.id
      join collections c on c.id = cp.collection_id and c.handle = 'trouwen'
      join product_images pi on pi.product_id = p.id and pi.source = ''
      where p.status = 'active' and p.has_image
      order by pi.position asc limit 1`,
    scene:
      "Golden-hour wedding moment in the South of France: warm sun-drenched Provencal stone courtyard with olive trees and soft flowers, honey-coloured limestone walls, a festive long table with wine glasses softly out of focus behind him. He glances aside with a warm genuine smile, one hand relaxed in his pocket. Warm golden Mediterranean light.",
  },
  {
    file: "brand-impression-interview.jpg",
    label: "Zakelijk",
    productSql: sql`
      select pi.url from products p
      join product_images pi on pi.product_id = p.id and pi.source = ''
      where p.status = 'active' and p.has_image
        and p.attributes->>'hoofdgroep_omschrijving' = 'Pakken'
        and (p.title ilike '%blauw%' or p.title ilike '%navy%' or p.variant_color_label ilike '%blauw%')
      order by p.stock_qty desc nulls last, pi.position asc limit 1`,
    scene:
      "Confident morning in a warm Southern-French city: walking past honey-coloured limestone facades with tall shuttered windows, a sunlit terrace cafe with marble tables behind him, espresso cups catching the light. Easy purposeful stride, a calm confident look. Soft warm morning Mediterranean sunlight.",
  },
  {
    file: "brand-impression-gala.jpg",
    label: "Gala & Black Tie",
    productSql: sql`
      select pi.url from products p
      join product_images pi on pi.product_id = p.id and pi.source = ''
      where p.status = 'active' and p.has_image and p.title ilike '%smoking%'
        and p.attributes->>'hoofdgroep_omschrijving' in ('Pakken', 'Colberts')
      order by p.stock_qty desc nulls last, pi.position asc limit 1`,
    scene:
      "Elegant dusk at a Riviera villa: warm lantern-lit Mediterranean courtyard with a grand stone staircase and cypress silhouettes against a deep-blue evening sky, champagne glasses glinting on a table softly out of focus. He stands poised with a quiet confident smile, one hand adjusting his cuff. He wears a black bow tie. Warm amber evening light.",
  },
  {
    file: "brand-impression-funeral.jpg",
    label: "Uitvaart",
    productSql: sql`
      select pi.url from products p
      join product_images pi on pi.product_id = p.id and pi.source = ''
      where p.status = 'active' and p.has_image
        and p.attributes->>'hoofdgroep_omschrijving' = 'Pakken'
        and (p.title ilike '%zwart%' or p.title ilike '%antraciet%' or p.variant_color_label ilike '%zwart%')
      order by p.stock_qty desc nulls last, pi.position asc limit 1`,
    scene:
      "Quiet, dignified and respectful: standing calmly in a peaceful old Southern-European stone chapel courtyard with tall cypress trees, soft diffused overcast light, muted warm tones. He wears a plain black necktie, neatly knotted, shirt fully buttoned. Hands folded calmly in front, a composed, serene expression — no smile. Sober, serene, full of quiet respect.",
  },
];

async function runProductToModel(productImage: string, prompt: string, apiKey: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let start: Response;
    try {
      start = await fetch(`${API}/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model_name: "product-to-model", inputs: { product_image: productImage, prompt, output_format: "jpeg", aspect_ratio: "4:5" } }),
      });
    } catch {
      await new Promise((r) => setTimeout(r, 6000 * (attempt + 1)));
      continue;
    }
    if (!start.ok) {
      if (start.status === 429 || start.status >= 500) { await new Promise((r) => setTimeout(r, 8000 * (attempt + 1))); continue; }
      console.error("  FASHN start-fout:", start.status, (await start.text()).slice(0, 160));
      return null;
    }
    const { id } = await start.json();
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      let j: { status?: string; output?: string[]; error?: unknown };
      try {
        const st = await fetch(`${API}/status/${id}`, { headers: { Authorization: `Bearer ${apiKey}` } });
        if (!st.ok) continue;
        j = await st.json();
      } catch { continue; }
      if (j.status === "completed" && j.output?.[0]) return j.output[0];
      if (j.status === "failed") {
        const msg = JSON.stringify(j.error || "").slice(0, 200);
        if (/unavailable|high load|temporarily|rate|timeout/i.test(msg)) break; // → retry
        console.error("  FASHN faalde:", msg);
        return null;
      }
    }
    await new Promise((r) => setTimeout(r, 6000 * (attempt + 1)));
  }
  console.error("  opgegeven na retries");
  return null;
}

async function main() {
  const apiKey = process.env.FASHN_API_KEY;
  if (!apiKey) { console.error("FASHN_API_KEY ontbreekt."); process.exit(1); }
  const db = getDb();
  const only = (process.argv[2] || "").trim().toLowerCase();

  let ok = 0;
  for (const t of TILES) {
    if (only && !t.label.toLowerCase().includes(only)) continue;
    const r = await db.execute<{ url: string }>(t.productSql);
    const productUrl = r.rows[0]?.url;
    if (!productUrl) { console.log(`✗ ${t.label}: geen productfoto gevonden`); continue; }
    console.log(`• ${t.label} ← ${productUrl.slice(0, 80)}`);
    const out = await runProductToModel(productUrl, `${t.scene} ${BASE}`, apiKey);
    if (!out) { console.log("  ✗ geen beeld"); continue; }
    const res = await fetch(out);
    if (!res.ok) { console.log("  ✗ download mislukt"); continue; }
    const buf = await sharp(Buffer.from(await res.arrayBuffer())).jpeg({ quality: 88 }).toBuffer();
    writeFileSync(`public/brand/${t.file}`, buf);
    ok++;
    console.log(`  ✓ public/brand/${t.file}`);
  }
  console.log(`\n✓ Klaar: ${ok} tegels vernieuwd. Commit + deploy om ze live te zetten.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
