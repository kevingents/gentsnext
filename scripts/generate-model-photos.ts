import "@/lib/load-env";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { products, productImages, productSizeMedia } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

/**
 * AI-modelfoto's genereren met FASHN.ai (virtual try-on): zet de bestaande
 * flat-/ghost-productfoto op een model. Doet per product een REGULIERE en een
 * GROTE-MAAT-variant en koppelt ze automatisch (model_image_url +
 * product_size_media). Resultaten gaan naar de Vercel-blobstore.
 *
 * Env (secrets, in Vercel):
 *   FASHN_API_KEY                – FASHN.ai API-key
 *   GENTS_MODEL_BASE_REGULAR     – URL van het reguliere model (canvas)
 *   GENTS_MODEL_BASE_PLUS        – URL van het plus-size model (optioneel)
 *   STOREGENTS_BLOB_READ_WRITE_TOKEN – voor het opslaan van de output
 *
 *   npm run generate:model-photos -- 25     (aantal producten deze run)
 */

const API = "https://api.fashn.ai/v1";

// hoofdgroep → FASHN-categorie (accessoires slaan we over: VTON werkt daar niet).
const CATEGORY: Record<string, "tops" | "bottoms" | "one-pieces"> = {
  Overhemden: "tops", Colberts: "tops", Truien: "tops", Gilets: "tops",
  "Polo-shirts": "tops", Vesten: "tops", "T-Shirts": "tops",
  Broeken: "bottoms",
  Pakken: "one-pieces",
};

async function runVTON(modelImage: string, garmentImage: string, category: string, apiKey: string): Promise<string | null> {
  const start = await fetch(`${API}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model_name: "tryon-v1.6",
      inputs: { model_image: modelImage, garment_image: garmentImage, category },
    }),
  });
  if (!start.ok) {
    console.error("  FASHN start-fout:", start.status, (await start.text()).slice(0, 160));
    return null;
  }
  const { id } = await start.json();
  // Pollen tot klaar (max ~60s).
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await fetch(`${API}/status/${id}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!st.ok) continue;
    const j = await st.json();
    if (j.status === "completed" && j.output?.[0]) return j.output[0];
    if (j.status === "failed") {
      console.error("  FASHN faalde:", JSON.stringify(j.error).slice(0, 160));
      return null;
    }
  }
  return null;
}

async function toBlob(url: string, path: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await put(path, await res.arrayBuffer(), { access: "public", token, contentType: "image/jpeg" });
    return blob.url;
  } catch (e) {
    console.error("  blob-upload-fout:", e);
    return null;
  }
}

async function main() {
  const apiKey = process.env.FASHN_API_KEY;
  const baseRegular = process.env.GENTS_MODEL_BASE_REGULAR;
  const basePlus = process.env.GENTS_MODEL_BASE_PLUS;
  const blobToken = process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  if (!apiKey || !baseRegular || !blobToken) {
    console.error("Zet FASHN_API_KEY, GENTS_MODEL_BASE_REGULAR en een blob-token. Plus-size: GENTS_MODEL_BASE_PLUS.");
    process.exit(1);
  }
  const limit = Math.max(1, Math.min(200, Number(process.argv[2]) || 20));
  const db = getDb();

  // Zichtbare apparel-producten met flat-foto, nog zonder modelfoto.
  const rows = await db.execute<{ id: string; handle: string; title: string; hg: string; img: string }>(sql`
    select p.id, p.handle, p.title, p.attributes->>'hoofdgroep_omschrijving' hg,
      (select pi.url from product_images pi where pi.product_id=p.id order by pi.position asc limit 1) img
    from products p
    where p.status='active' and p.has_image and p.in_stock and p.is_group_primary and p.model_image_url=''
      and p.attributes->>'hoofdgroep_omschrijving' in (${sql.join(Object.keys(CATEGORY).map((k) => sql`${k}`), sql`, `)})
    order by p.stock_qty desc
    limit ${limit}
  `);
  console.log(`⏳ ${rows.rows.length} producten te verwerken…`);

  let done = 0;
  for (const r of rows.rows) {
    const category = CATEGORY[r.hg];
    if (!category || !r.img) continue;
    console.log(`• ${r.handle} (${r.hg})`);

    // Regulier
    const reg = await runVTON(baseRegular, r.img, category, apiKey);
    if (reg) {
      const u = await toBlob(reg, `ai-models/${r.handle}-model.jpg`, blobToken);
      if (u) {
        await db.update(products).set({ modelImageUrl: u, modelImageAlt: `${r.title} — op model` }).where(eq(products.id, r.id));
        done++;
      }
    }
    // Grote maat
    if (basePlus) {
      const plus = await runVTON(basePlus, r.img, category, apiKey);
      if (plus) {
        const u = await toBlob(plus, `ai-models/${r.handle}-plus.jpg`, blobToken);
        if (u) {
          await db
            .insert(productSizeMedia)
            .values({ productId: r.id, threshold: "XXL", url: u, alt: `${r.title} — grote maat` })
            .onConflictDoUpdate({ target: productSizeMedia.productId, set: { url: u, updatedAt: sql`now()` } });
        }
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
