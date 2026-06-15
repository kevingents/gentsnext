import "@/lib/load-env";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * AI-modelfoto's genereren met FASHN.ai **Product to Model** (model_name
 * "product-to-model"): geef de productfoto + een categorie-prompt, en FASHN
 * genereert ZELF een model + styling + schone studio-achtergrond rond het echte
 * product. Geen canvas-model nodig (dat gaf bare-chest/sneakers). Het getoonde
 * product blijft accuraat; FASHN stylet de rest contextueel (overhemd, schoenen,
 * bij smokingoverhemden zelfs een vlinderstrik). Resultaten → Vercel-blobstore →
 * products.model_image_url (leidt de PDP-galerij).
 *
 * Env (secrets, in Vercel):
 *   FASHN_API_KEY                     – FASHN.ai API-key
 *   STOREGENTS_BLOB_READ_WRITE_TOKEN  – voor het opslaan van de output
 *
 *   npm run generate:model-photos -- 25                    (25 producten deze run)
 *   npm run generate:model-photos -- 1 lakschoen           (één product gericht (her)genereren)
 *   npm run generate:model-photos -- 25 "" Schoenen        (beperk tot één hoofdgroep)
 */

const API = "https://api.fashn.ai/v1";

/** Per-categorie prompt: bepaalt styling + uitsnede zodat de catalogus consistent oogt. */
const STUDIO = "Clean seamless white studio background, soft even lighting, sharp high-end menswear e-commerce catalog quality. The shown product must stay accurate to the reference photo.";
const FULL = "Full-length photograph, natural confident standing pose, hands relaxed.";
const UPPER = "Photograph framed from roughly the knees up, natural confident pose.";
const LOWER = "Photograph framed from roughly the waist down, focus on the lower body and footwear.";

const PROMPTS: Record<string, string> = {
  Pakken: `Male model wearing THIS suit, complete with a crisp white dress shirt and black leather oxford shoes. ${FULL} ${STUDIO}`,
  Colberts: `Male model wearing THIS blazer over a crisp white dress shirt, with matching trousers and black leather shoes. ${FULL} ${STUDIO}`,
  Gilets: `Male model wearing THIS waistcoat over a white dress shirt, with matching trousers and black leather shoes. ${FULL} ${STUDIO}`,
  Jassen: `Male model wearing THIS coat over neat menswear, with trousers and leather shoes. ${FULL} ${STUDIO}`,
  Broeken: `Male model wearing THESE trousers with a tucked light dress shirt and leather shoes. ${FULL} ${STUDIO}`,
  Overhemden: `Male model wearing THIS shirt, neatly styled with trousers. ${UPPER} ${STUDIO}`,
  Truien: `Male model wearing THIS knitwear, styled with neat trousers. ${UPPER} ${STUDIO}`,
  Vesten: `Male model wearing THIS cardigan/vest over a shirt, styled with neat trousers. ${UPPER} ${STUDIO}`,
  "Polo-shirts": `Male model wearing THIS polo shirt, styled with neat trousers. ${UPPER} ${STUDIO}`,
  "T-Shirts": `Male model wearing THIS t-shirt, styled casually with neat trousers. ${UPPER} ${STUDIO}`,
  Schoenen: `Male model wearing THESE shoes with well-fitted trousers. ${LOWER} ${STUDIO}`,
};

/** Shopify-CDN-URL → master zonder width/height-cap (scherpste FASHN-input). */
function toFullRes(url: string): string {
  try {
    const u = new URL(url);
    if (u.pathname.includes("/cdn/shop") || u.hostname.endsWith("shopify.com")) {
      u.searchParams.delete("width");
      u.searchParams.delete("height");
    }
    return u.toString();
  } catch {
    return url;
  }
}

async function runProductToModel(productImage: string, prompt: string, apiKey: string): Promise<string | null> {
  const start = await fetch(`${API}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model_name: "product-to-model",
      inputs: { product_image: toFullRes(productImage), prompt, output_format: "jpeg" },
    }),
  });
  if (!start.ok) {
    console.error("  FASHN start-fout:", start.status, (await start.text()).slice(0, 200));
    return null;
  }
  const { id } = await start.json();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const st = await fetch(`${API}/status/${id}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!st.ok) continue;
    const j = await st.json();
    if (j.status === "completed" && j.output?.[0]) return j.output[0];
    if (j.status === "failed") {
      console.error("  FASHN faalde:", JSON.stringify(j.error).slice(0, 200));
      return null;
    }
  }
  return null;
}

async function toBlob(url: string, path: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await put(path, await res.arrayBuffer(), { access: "public", token, contentType: "image/jpeg", allowOverwrite: true });
    return blob.url;
  } catch (e) {
    console.error("  blob-upload-fout:", e);
    return null;
  }
}

async function main() {
  const apiKey = process.env.FASHN_API_KEY;
  const blobToken = process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  if (!apiKey || !blobToken) {
    console.error("Zet FASHN_API_KEY en een blob-token (STOREGENTS_BLOB_READ_WRITE_TOKEN).");
    process.exit(1);
  }
  const limit = Math.max(1, Math.min(300, Number(process.argv[2]) || 20));
  const onlyHandle = (process.argv[3] || "").trim();
  const onlyHg = (process.argv[4] || "").trim(); // optioneel: beperk tot één hoofdgroep
  const db = getDb();

  const cats = onlyHg ? [onlyHg] : Object.keys(PROMPTS);
  const rows = await db.execute<{ id: string; handle: string; title: string; hg: string; img: string }>(sql`
    select p.id, p.handle, p.title, p.attributes->>'hoofdgroep_omschrijving' hg,
      (select pi.url from product_images pi where pi.product_id=p.id order by pi.position asc limit 1) img
    from products p
    where p.status='active' and p.has_image and p.in_stock and p.is_group_primary
      ${onlyHandle ? sql`and p.handle = ${onlyHandle}` : sql`and p.model_image_url=''`}
      and p.attributes->>'hoofdgroep_omschrijving' in (${sql.join(cats.map((k) => sql`${k}`), sql`, `)})
    order by p.stock_qty desc
    limit ${limit}
  `);
  console.log(`⏳ ${rows.rows.length} producten te verwerken (product-to-model)…`);

  let done = 0;
  for (const r of rows.rows) {
    const prompt = PROMPTS[r.hg];
    if (!prompt || !r.img) continue;
    console.log(`• ${r.handle} (${r.hg})`);
    const out = await runProductToModel(r.img, prompt, apiKey);
    if (out) {
      const u = await toBlob(out, `ai-models/${r.handle}-model.jpg`, blobToken);
      if (u) {
        await db.update(products).set({ modelImageUrl: u, modelImageAlt: `${r.title} — op model` }).where(eq(products.id, r.id));
        done++;
      }
    }
  }
  console.log(`\n✓ Klaar — ${done} modelfoto's gegenereerd. Controleer/keur ze; ze leiden nu de galerij.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
