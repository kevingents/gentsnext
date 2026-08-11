import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { modelStylePrompt } from "@/lib/model-styling";
import { getModelLearnings, modelPromptBlocks } from "@/lib/model-learnings";

/**
 * Eén modelfoto (her)genereren via FASHN product-to-model, MÉT de geleerde
 * smaak (modelPromptBlocks), kleur-bewuste styling (modelStylePrompt) en native
 * 4:5. Gebruikt door de portal "Modellen-studio" (regenerate-knop).
 *
 * Gaat de feedback alleen over de kleding, dan houden we via face_reference
 * dezelfde man vast — zie de toelichting bij regenerateModelPhoto.
 */
const API = "https://api.fashn.ai/v1";
const STUDIO = "Clean seamless studio background in a soft neutral light grey, soft even lighting, sharp high-end menswear e-commerce catalog quality. The shown product must stay accurate to the reference photo.";
const POSE = "Relaxed full-length pose, one hand casually in his trouser pocket, weight on one leg, warm genuine smile, looking softly into the camera.";

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

async function runProductToModel(productImage: string, prompt: string, apiKey: string, faceRef = ""): Promise<string | null> {
  const inputs: Record<string, unknown> = { product_image: productImage, prompt, output_format: "jpeg", aspect_ratio: "4:5" };
  if (faceRef) { inputs.face_reference = faceRef; inputs.face_reference_mode = "match_reference"; }
  const start = await fetch(`${API}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model_name: "product-to-model", inputs }),
  });
  if (!start.ok) return null;
  const { id } = await start.json();
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const st = await fetch(`${API}/status/${id}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!st.ok) continue;
    const j = await st.json();
    if (j.status === "completed" && j.output?.[0]) return j.output[0];
    if (j.status === "failed") return null;
  }
  return null;
}

export async function regenerateModelPhoto(handle: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const apiKey = process.env.FASHN_API_KEY;
  const token = process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  if (!apiKey) return { ok: false, error: "FASHN_API_KEY ontbreekt." };
  if (!token) return { ok: false, error: "blob-token ontbreekt." };
  if (!handle) return { ok: false, error: "handle vereist." };

  const db = getDb();
  const [p] = (
    await db.execute<{ id: string; title: string; hg: string; vcl: string | null; img: string; huidig: string | null }>(sql`
      select p.id, p.title, p.attributes->>'hoofdgroep_omschrijving' hg, p.variant_color_label vcl,
        split_part(p.model_image_url,'?',1) huidig,
        (select pi.url from product_images pi where pi.product_id=p.id order by pi.position asc limit 1) img
      from products p where p.handle = ${handle}`)
  ).rows;
  if (!p?.img) return { ok: false, error: "Product of productfoto niet gevonden." };

  const style = modelStylePrompt(p.hg, p.vcl, p.title, handle);
  // Kleding-regels vlak achter de zin over het kledingstuk, model-regels achter
  // de pose/studio-zinnen, en de correcties voor precies dit product als laatste
  // — daar leest de generator ze het scherpst en verdrinken ze niet tussen de
  // algemene huisregels. Zie de toelichting in lib/model-learnings.ts.
  const learn = modelPromptBlocks(await getModelLearnings(), { handle });
  const prompt = `${garmentFor(p.hg, style)}${learn.garment} ${POSE} ${STUDIO}${learn.model}${learn.fix}`;

  // FASHN maakt elke keer een compleet nieuwe foto vanaf de packshot: vraag je om
  // kortere mouwen, dan krijg je óók een andere man. Gaat alle openstaande
  // feedback over de kleding en niets over de persoon, dan geven we de huidige
  // foto mee als face_reference — zelfde man, alleen de kleding verandert. Is er
  // wél model-feedback, dan moet die man juist wég en laten we hem los.
  const zelfdeMan = learn.fixTopics.garment && !learn.fixTopics.model ? p.huidig || "" : "";
  const out = await runProductToModel(p.img, prompt, apiKey, zelfdeMan);
  if (!out) return { ok: false, error: "FASHN-generatie mislukt." };
  try {
    const buf = Buffer.from(await (await fetch(out)).arrayBuffer());
    const b = await put(`ai-models/${handle}-model.jpg`, buf, { access: "public", token, contentType: "image/jpeg", allowOverwrite: true });
    const url = `${b.url}?v=${Date.now()}`;
    await db.update(products).set({ modelImageUrl: url, modelImageAlt: `${p.title} — op model` }).where(eq(products.id, p.id));
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
