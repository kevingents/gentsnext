import "@/lib/load-env";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { modelStylePrompt } from "@/lib/model-styling";

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
 *   npm run generate:model-photos -- 9 "a,b,c"             (meerdere handles gericht (her)genereren, komma-gescheiden)
 *   npm run generate:model-photos -- 60 redo "a,b"         (bestaande modelfoto's HERgeneren, m.u.v. handles a,b)
 *   npm run generate:model-photos -- 25 "" Schoenen        (beperk tot één hoofdgroep)
 */

const API = "https://api.fashn.ai/v1";

/**
 * Styling per categorie + een ROTERENDE set relaxte poses (Mr Marvis-stijl:
 * ontspannen houding, hand in zak, warme glimlach). We kiezen de pose op
 * volgnummer zodat opeenvolgende producten niet identiek/stijf ogen — de
 * catalogus oogt gevarieerd en lifestyle i.p.v. paspoort-recht. Achtergrond is
 * vast (zelfde neutrale lichtgrijs) zodat alles ondanks de variatie één lijn houdt.
 */
const STUDIO = "Clean seamless studio background in a soft neutral light grey, soft even lighting, sharp high-end menswear e-commerce catalog quality. The shown product must stay accurate to the reference photo.";

// Meeste poses camera-gericht + warme glimlach; een paar candid (lopend/zijwaarts) voor afwisseling.
const POSES_FULL = [
  "Relaxed full-length pose, one hand casually in his trouser pocket, weight on one leg, warm genuine smile, looking softly into the camera.",
  "Easy full-length stance at a slight three-quarter angle, both hands loosely in his pockets, friendly relaxed smile, looking into the camera.",
  "Laid-back full-length contrapposto pose, arms relaxed at his sides, head tilted slightly, approachable natural smile, looking into the camera.",
  "Candid full-length shot, caught mid-stride walking slowly toward the camera, relaxed shoulders, light spontaneous smile.",
  "Relaxed full-length pose, one hand adjusting his shirt cuff, soft confident smile, glancing just off to the side.",
];
const POSES_UPPER = [
  "Relaxed pose framed from the knees up, one hand in his pocket, warm genuine smile, looking softly into the camera.",
  "Easy knees-up framing, casual three-quarter turn, arms loosely crossed, friendly relaxed smile, looking into the camera.",
  "Laid-back knees-up shot, one hand running lightly through his hair, natural spontaneous smile, glancing off to the side.",
  "Knees-up framing, at ease with both hands in his pockets, head tilted slightly, approachable warm smile, looking into the camera.",
];
const POSES_LOWER = [
  "Framed from the waist down, focus on the lower body and footwear, relaxed stance with weight on one leg and one foot slightly forward.",
  "Framed from the waist down, focus on the lower body and footwear, caught mid-stride in an easy natural walk.",
  "Framed from the waist down, focus on the lower body and footwear, casual stance with feet slightly apart and weight shifted to one side.",
];

type Frame = "full" | "upper" | "lower";
type StyleParts = { shirt: string; shoes: string };
const STYLE: Record<string, { garment: (s: StyleParts) => string; frame: Frame }> = {
  Pakken: { garment: (s) => `Male model wearing THIS suit, complete with ${s.shirt} and ${s.shoes}.`, frame: "full" },
  Colberts: { garment: (s) => `Male model wearing THIS blazer over ${s.shirt}, with matching trousers and ${s.shoes}.`, frame: "full" },
  Gilets: { garment: (s) => `Male model wearing THIS waistcoat over ${s.shirt}, with matching trousers and ${s.shoes}. The lowest button of the waistcoat is left open.`, frame: "full" },
  Jassen: { garment: () => "Male model wearing THIS coat over neat menswear, with trousers and leather shoes.", frame: "full" },
  Broeken: { garment: (s) => `Male model wearing THESE trousers with a tucked ${s.shirt} and ${s.shoes}.`, frame: "full" },
  Overhemden: { garment: () => "Male model wearing THIS shirt, neatly styled with trousers.", frame: "upper" },
  Truien: { garment: () => "Male model wearing THIS knitwear, styled with neat trousers.", frame: "upper" },
  Vesten: { garment: () => "Male model wearing THIS cardigan/vest over a shirt, styled with neat trousers.", frame: "upper" },
  "Polo-shirts": { garment: () => "Male model wearing THIS polo shirt, styled with neat trousers.", frame: "upper" },
  "T-Shirts": { garment: () => "Male model wearing THIS t-shirt, styled casually with neat trousers.", frame: "upper" },
  Schoenen: { garment: () => "Male model wearing THESE shoes with well-fitted trousers.", frame: "lower" },
};

/**
 * Bouwt de prompt: kleur-bewuste styling (warm pak → cognac/bruine schoenen,
 * wit kraag-overhemd; volgens model-styling.ts) + een relaxte pose + vaste studio.
 */
function buildPrompt(cat: string, i: number, ctx: { color?: string | null; title: string; handle: string }): string | null {
  const s = STYLE[cat];
  if (!s) return null;
  const style = modelStylePrompt(cat, ctx.color, ctx.title, ctx.handle);
  const pool = s.frame === "full" ? POSES_FULL : s.frame === "upper" ? POSES_UPPER : POSES_LOWER;
  return `${s.garment(style)} ${pool[i % pool.length]} ${STUDIO}`;
}

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
      // FASHN levert meteen 4:5 (= onze tegel-ratio) → geen pad/crop, gradient
      // loopt native tot de randen. padTo45 blijft als vangnet (no-op bij 4:5).
      inputs: { product_image: toFullRes(productImage), prompt, output_format: "jpeg", aspect_ratio: "4:5" },
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

// Pad naar exact 4:5 zodat de modelfoto de 4:5-galerijtegel naadloos vult (geen
// cream zijbanden). Rand-gemiddelde als achtergrond → blendt met de studio.
async function padTo45(buf: Buffer): Promise<Buffer> {
  try {
    const m = await sharp(buf).metadata();
    const w = m.width ?? 0, h = m.height ?? 0;
    if (!w || !h) return buf;
    const target = 4 / 5, ratio = w / h;
    if (Math.abs(ratio - target) < 0.01) return buf;
    // Trek de RANDPIXELS door in de pad-zones (extendWith 'copy'). Boven het hoofd
    // en onder de voeten is dat pure studio-achtergrond, dus de zachte gradient
    // loopt naadloos door — GEEN vlakke balk én GEEN model-echo/spiegeling.
    if (ratio > target) {
      const th = Math.round(w / target);
      const top = Math.floor((th - h) / 2);
      return sharp(buf).extend({ top, bottom: th - h - top, extendWith: "copy" }).jpeg({ quality: 90 }).toBuffer();
    }
    const tw = Math.round(h * target);
    const left = Math.floor((tw - w) / 2);
    return sharp(buf).extend({ left, right: tw - w - left, extendWith: "copy" }).jpeg({ quality: 90 }).toBuffer();
  } catch { return buf; }
}
async function toBlob(url: string, path: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const padded = await padTo45(Buffer.from(await res.arrayBuffer()));
    const blob = await put(path, padded, { access: "public", token, contentType: "image/jpeg", allowOverwrite: true });
    return `${blob.url}?v=${Date.now()}`;
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
  const arg3 = (process.argv[3] || "").trim();
  // "redo" → bestaande modelfoto's HERgeneren (bv. na een pose-wijziging); argv[4]
  // = optionele uitsluitlijst. Anders: één of meer handles (komma-gescheiden) voor
  // gerichte (her)generatie. Standaard: alleen producten zónder modelfoto.
  const redoExisting = arg3.toLowerCase() === "redo";
  const handleList = redoExisting ? [] : arg3.split(",").map((h) => h.trim()).filter(Boolean);
  const excludeList = redoExisting ? (process.argv[4] || "").split(",").map((h) => h.trim()).filter(Boolean) : [];
  const onlyHg = redoExisting ? "" : (process.argv[4] || "").trim(); // optioneel: beperk tot één hoofdgroep
  const db = getDb();

  const cats = onlyHg ? [onlyHg] : Object.keys(STYLE);
  const rows = await db.execute<{ id: string; handle: string; title: string; hg: string; vcl: string | null; img: string }>(sql`
    select p.id, p.handle, p.title, p.attributes->>'hoofdgroep_omschrijving' hg, p.variant_color_label vcl,
      (select pi.url from product_images pi where pi.product_id=p.id order by pi.position asc limit 1) img
    from products p
    where p.status='active' and p.has_image and p.in_stock and p.is_group_primary
      ${handleList.length
        ? sql`and p.handle in (${sql.join(handleList.map((h) => sql`${h}`), sql`, `)})`
        : redoExisting
          ? sql`and p.model_image_url <> ''`
          : sql`and p.model_image_url = ''`}
      ${excludeList.length ? sql`and p.handle not in (${sql.join(excludeList.map((h) => sql`${h}`), sql`, `)})` : sql``}
      and p.attributes->>'hoofdgroep_omschrijving' in (${sql.join(cats.map((k) => sql`${k}`), sql`, `)})
    order by p.stock_qty desc
    limit ${limit}
  `);
  console.log(`⏳ ${rows.rows.length} producten te verwerken (product-to-model)…`);

  let done = 0, err = 0, seen = 0;
  const rowsArr = rows.rows;
  const CONC = 5; // onder FASHN's 6-concurrency-limiet
  async function handle(r: (typeof rowsArr)[number], i: number) {
    try {
      const prompt = buildPrompt(r.hg, i, { color: r.vcl, title: r.title, handle: r.handle });
      if (!prompt || !r.img) return;
      const out = await runProductToModel(r.img, prompt, apiKey);
      if (!out) { err++; return; }
      // FASHN levert native 4:5 (aspect_ratio); padTo45 is dan een no-op.
      const u = await toBlob(out, `ai-models/${r.handle}-model.jpg`, blobToken);
      if (!u) { err++; return; }
      await db.update(products).set({ modelImageUrl: u, modelImageAlt: `${r.title} — op model` }).where(eq(products.id, r.id));
      done++;
    } catch { err++; }
  }
  for (let i = 0; i < rowsArr.length; i += CONC) {
    const chunk = rowsArr.slice(i, i + CONC);
    await Promise.all(chunk.map((r, j) => handle(r, i + j)));
    seen = Math.min(i + CONC, rowsArr.length);
    console.log(`  …${seen}/${rowsArr.length} (klaar ${done}, fout ${err})`);
  }
  console.log(`\n✓ Klaar — ${done} modelfoto's gegenereerd, ${err} fout. Ze leiden de galerij.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
