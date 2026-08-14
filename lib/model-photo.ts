import { put, del } from "@vercel/blob";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { modelStylePrompt, garmentSentence, frameFor } from "@/lib/model-styling";
import { getModelLearnings, modelPromptBlocks } from "@/lib/model-learnings";
import { modelRefById } from "@/lib/brand-models";

/**
 * Eén modelfoto (her)genereren via FASHN product-to-model, MÉT de geleerde
 * smaak (modelPromptBlocks), kleur-bewuste styling (modelStylePrompt) en native
 * 4:5. Gebruikt door de portal "Modellen-studio" (regenerate-knop).
 *
 * Staat er geen enkele correctie open, dan houden we via face_reference dezelfde
 * man vast — zie de toelichting bij regenerateModelPhoto.
 */
const API = "https://api.fashn.ai/v1";
const STUDIO = "Clean seamless studio background in a soft neutral light grey, soft even lighting, sharp high-end menswear e-commerce catalog quality. The shown product must stay accurate to the reference photo.";
/**
 * Het kader volgt frameFor() uit model-styling, zodat een hergenereerde foto
 * dezelfde uitsnede krijgt als het bulk-script. Deze hergenerator zette altijd
 * een héle man neer — dus beoordeelde je bij een lakschoen ineens een compleet
 * pak, en dan is er altijd wel iets mis.
 */
const POSES: Record<string, string> = {
  full: "Relaxed full-length pose, one hand casually in his trouser pocket, weight on one leg, warm genuine smile, looking softly into the camera.",
  upper: "Relaxed pose framed from the knees up, one hand in his pocket, warm genuine smile, looking softly into the camera.",
  lower: "Framed from the waist down, focus on the lower body and footwear, relaxed stance with weight on one leg and one foot slightly forward.",
};

/* De zin over het kledingstuk komt uit lib/model-styling.ts — één bron voor
   deze hergenerator, de bulk-generator en de tweede pose. */

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

/**
 * Wie er op de foto staat.
 *  - "zelfde"  (standaard) — de man van de huidige foto vasthouden, mits er geen
 *               correctie openstaat. Dit was het enige gedrag.
 *  - "fashn"   — geen face_reference; FASHN verzint een gezicht. Kost 3 credits
 *               minder, maar je krijgt elke keer iemand anders.
 *  - een id uit BRAND_MODELS ("a".."e") — dít merkmodel.
 */
export type ModelKeuze = "zelfde" | "fashn" | string;

export async function regenerateModelPhoto(
  handle: string,
  opties: { model?: ModelKeuze } = {},
): Promise<{ ok: boolean; url?: string; error?: string }> {
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
  // Correcties staan zowel vooraan (lead) als achteraan (fix). De zin over het
  // kledingstuk is hardgecodeerd — bij Colberts letterlijk "with matching
  // trousers" — en stond vóór de correctie. Wie om een ándere broekkleur vroeg,
  // verloor het van die vaste zin. Zie lib/model-learnings.ts.
  const learn = modelPromptBlocks(await getModelLearnings(), { handle });
  // En bij een openstaande kleding-correctie laten we "matching" vallen: dat ene
  // bijvoeglijk naamwoord is precies waar de klacht over ging ("dit colbert heeft
  // geen broek, dus doe er een andere kleur broek onder"). De zin blijft heel,
  // de tegenspraak verdwijnt.
  const kledingZin = learn.fixTopics.garment
    ? garmentSentence(p.hg, style).replace(/with matching trousers/gi, "with trousers")
    : garmentSentence(p.hg, style);
  const pose = POSES[frameFor(p.hg)];
  const prompt = `${learn.lead}${kledingZin}${learn.garment} ${pose} ${STUDIO}${learn.model}${learn.fix}`;

  /* Welk gezicht als face_reference meegaat.
     - Kiest de gebruiker expliciet een merkmodel, dan is dát het antwoord: hij
       heeft gezien wat er staat en wil dít gezicht. Dan geldt het voorbehoud
       hieronder niet, want de referentie is niet meer de afgekeurde foto.
     - "fashn" = geen referentie, FASHN verzint iemand.
     - "zelfde" (standaard) houdt de man van de huidige foto vast — prettig als
       je niets aan te merken hebt en gewoon een andere take wilt. Maar dan is het
       referentiebeeld de foto die NET is afgekeurd, en die als "hier moet het op
       lijken" meegeven werkt tegen elke correctie in. Dus alleen vasthouden als
       er niets openstaat. */
  const keuze = String(opties.model || "zelfde");
  let faceRef: string;
  if (keuze === "fashn") faceRef = "";
  else if (keuze !== "zelfde") {
    faceRef = modelRefById(keuze);
    if (!faceRef) return { ok: false, error: `Onbekend model: "${keuze}".` };
  } else {
    faceRef = !learn.fixTopics.garment && !learn.fixTopics.model ? p.huidig || "" : "";
  }
  const out = await runProductToModel(p.img, prompt, apiKey, faceRef);
  if (!out) return { ok: false, error: "FASHN-generatie mislukt." };
  try {
    const buf = Buffer.from(await (await fetch(out)).arrayBuffer());
    // ELKE generatie een eigen pad. Voorheen ging alles naar hetzelfde
    // ai-models/<handle>-model.jpg met allowOverwrite; blob-objecten worden op
    // pad gecachet (standaard een maand, en de ?v= erachter telt niet mee voor
    // dat cachesleutel), dus kreeg je een tijd lang je oude foto terug — vandaar
    // "vier keer drukken voor een nieuwe afbeelding". Een nieuw pad kán niet
    // gecachet zijn. De vorige versie ruimen we daarna op.
    const vorige = p.huidig || "";
    const b = await put(`ai-models/${handle}-model-${Date.now()}.jpg`, buf, {
      access: "public",
      token,
      contentType: "image/jpeg",
      cacheControlMaxAge: 0,
    });
    const url = b.url;
    await db.update(products).set({ modelImageUrl: url, modelImageAlt: `${p.title} — op model` }).where(eq(products.id, p.id));
    // Pas opruimen ná de db-update: gaat het verwijderen mis, dan staat de site
    // in elk geval al op de nieuwe foto.
    if (vorige && vorige !== url.split("?")[0]) {
      try { await del(vorige, { token }); } catch { /* blob al weg */ }
    }
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
