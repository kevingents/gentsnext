import "@/lib/load-env";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { modelStylePrompt } from "@/lib/model-styling";
import { getModelLearnings, modelLearningsBlock } from "@/lib/model-learnings";

/**
 * Hergenereert de TWEEDE modelpose (model_image_url2) in de NIEUWE stijl: native
 * 4:5, kleur-bewuste styling (modelStylePrompt), geleerde model-smaak
 * (modelLearningsBlock) en — cruciaal — DEZELFDE man als pose 1 via
 * face_reference = de nieuwe model_image_url. Zo matchen pose 1 & 2 weer.
 *
 *   npx tsx scripts/regenerate-m2.ts            (alle producten met een 2e pose)
 *   npx tsx scripts/regenerate-m2.ts <handle>   (alleen dat product)
 */
const API = "https://api.fashn.ai/v1";
const STUDIO = "Clean seamless studio background in a soft neutral light grey, soft even lighting, sharp high-end menswear e-commerce catalog quality. The shown product must stay accurate to the reference photo.";
const POSE2 = "Full-length editorial pose, half-turned away looking back over his shoulder toward the camera, one hand relaxed at his side, a subtle confident natural smile.";
const CONC = 4;

function garmentFor(hg: string, s: { shirt: string; shoes: string }): string {
  switch (hg) {
    case "Pakken": return `Male model wearing THIS suit, complete with ${s.shirt} and ${s.shoes}.`;
    case "Colberts": return `Male model wearing THIS blazer over ${s.shirt}, with matching trousers and ${s.shoes}.`;
    case "Gilets": return `Male model wearing THIS waistcoat over ${s.shirt}, with matching trousers and ${s.shoes}. The lowest button of the waistcoat is left open.`;
    case "Broeken": return `Male model wearing THESE trousers with a tucked ${s.shirt} and ${s.shoes}.`;
    case "Overhemden": return "Male model wearing THIS shirt, neatly styled with trousers.";
    case "Truien": case "Vesten": return "Male model wearing THIS knitwear, styled with neat trousers.";
    case "Polo-shirts": return "Male model wearing THIS polo shirt, styled with neat trousers.";
    case "T-Shirts": return "Male model wearing THIS t-shirt, styled casually with neat trousers.";
    case "Jassen": return "Male model wearing THIS coat over neat menswear, with trousers and leather shoes.";
    default: return "Male model wearing THIS item, neatly styled with matching menswear.";
  }
}

async function run(productImage: string, prompt: string, faceRef: string, apiKey: string): Promise<string | null> {
  const inputs: Record<string, unknown> = { product_image: productImage, prompt, output_format: "jpeg", aspect_ratio: "4:5" };
  if (faceRef) { inputs.face_reference = faceRef; inputs.face_reference_mode = "match_reference"; }
  const start = await fetch(`${API}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model_name: "product-to-model", inputs }),
  });
  if (!start.ok) return null;
  const { id } = await start.json();
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const st = await fetch(`${API}/status/${id}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!st.ok) continue;
    const j = await st.json();
    if (j.status === "completed" && j.output?.[0]) return j.output[0] as string;
    if (j.status === "failed") return null;
  }
  return null;
}

type Row = { id: string; handle: string; title: string; hg: string; vcl: string | null; m1: string; img: string };

async function main() {
  const apiKey = process.env.FASHN_API_KEY!;
  const token = (process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN)!;
  if (!apiKey || !token) { console.error("FASHN_API_KEY of blob-token ontbreekt"); process.exit(1); }
  const db = getDb();
  const only = (process.argv[2] || "").trim();

  const rows = (await db.execute<Row>(sql`
    select p.id, p.handle, p.title, p.attributes->>'hoofdgroep_omschrijving' hg, p.variant_color_label vcl,
      split_part(p.model_image_url,'?',1) m1,
      (select pi.url from product_images pi where pi.product_id=p.id order by pi.position asc limit 1) img
    from products p
    where p.model_image_url2 <> '' and p.model_image_url <> ''
      ${only ? sql`and p.handle = ${only}` : sql``}
    order by p.handle`)).rows;

  console.log(`⏳ ${rows.length} tweede-poses hergenereren (zelfde man als pose 1)…`);
  const learn = modelLearningsBlock(await getModelLearnings());
  let done = 0, err = 0;

  async function worker(slice: Row[]) {
    for (const r of slice) {
      if (!r.img || !r.m1) { err++; done++; continue; }
      try {
        const style = modelStylePrompt(r.hg, r.vcl, r.title, r.handle);
        const prompt = `${garmentFor(r.hg, style)} ${POSE2} ${STUDIO}${learn}`;
        const out = await run(r.img, prompt, r.m1, apiKey);
        if (!out) { err++; done++; continue; }
        const buf = Buffer.from(await (await fetch(out)).arrayBuffer());
        let saved = "";
        for (let a = 1; a <= 3 && !saved; a++) {
          try { const b = await put(`ai-models/${r.handle}-model2.jpg`, buf, { access: "public", token, contentType: "image/jpeg", allowOverwrite: true }); saved = `${b.url}?v=${Date.now()}`; }
          catch { await new Promise((rr) => setTimeout(rr, 1500 * a)); }
        }
        if (!saved) { err++; done++; continue; }
        await db.update(products).set({ modelImageUrl2: saved, modelImageAlt2: `${r.title} — op model (2)` }).where(eq(products.id, r.id));
      } catch { err++; }
      done++;
      if (done % 5 === 0) console.log(`  …${done}/${rows.length} (klaar ${done - err}, fout ${err})`);
    }
  }

  const chunks: Row[][] = Array.from({ length: CONC }, () => []);
  rows.forEach((r, i) => chunks[i % CONC].push(r));
  await Promise.all(chunks.map(worker));

  console.log(`\n✓ Klaar — ${done} verwerkt, ${err} fout.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
