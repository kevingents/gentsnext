import "@/lib/load-env";
import { put } from "@vercel/blob";
import sharp from "sharp";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Algemene AI-media voor NIET-pakken-producten zonder modelfoto. Garments krijgen
 * een modelfoto (geroteerde pose) + 720p-video; dassen/strikken alleen een
 * gestylde modelfoto (video is daar overkill). Hergebruikt de pakken-pijplijn:
 * 5 vaste merk-modellen via face_reference (geroteerd), 4:5-padding (geen kader),
 * cache-bust, en robuust tegen transiente netwerk-/DB-fouten.
 *
 *   npm run gen:product-media -- 100                 (100 producten deze run)
 *   npm run gen:product-media -- 100 Overhemden      (alleen één categorie)
 */

const API = "https://api.fashn.ai/v1";
const STUDIO = "Clean seamless studio background in a soft neutral light grey, soft even lighting, sharp high-end menswear e-commerce catalog quality. The shown product must stay accurate to the reference photo.";

const POSES_FULL = [
  "Relaxed full-length pose, standing with one hand casually in his trouser pocket, weight on one leg, warm genuine smile, looking softly into the camera.",
  "Easy full-length stance at a slight three-quarter angle, both hands loosely in his pockets, friendly relaxed smile, looking into the camera.",
  "Full-length contrapposto, standing with one hand on his hip and the other relaxed at his side, confident easy smile, looking into the camera.",
  "Candid full-length shot, caught mid-stride walking slowly toward the camera, relaxed shoulders, light spontaneous smile.",
  "Full-length editorial pose, leaning back against a wall with one foot up, arms relaxed, calm natural expression, glancing just off to the side.",
  "Full-length pose, half-turned away looking back over his shoulder toward the camera, one hand in pocket, a subtle confident smile.",
  "Full-length stance, arms loosely folded, weight on one leg, an easy candid smile, looking into the camera.",
  "Full-length pose, adjusting his jacket or shirt cuff with both hands, eyes down, a relaxed natural moment, not looking at the camera.",
];
const POSES_UPPER = [
  "Relaxed pose framed from the knees up, standing with one hand in his pocket, warm genuine smile, looking softly into the camera.",
  "Knees-up framing, standing at a three-quarter angle with arms loosely crossed, friendly relaxed smile, looking into the camera.",
  "Knees-up shot, standing with one hand on his hip and the other at his side, confident easy smile, glancing off to the side.",
  "Knees-up framing, standing with both hands in his pockets, head tilted slightly, approachable warm smile, looking into the camera.",
  "Knees-up editorial pose, leaning a shoulder lightly against a wall, hands relaxed, calm natural expression, looking just past the camera.",
  "Knees-up shot, half-turned away with his face looking back over his shoulder toward the camera, a subtle confident smile.",
  "Knees-up framing, arms folded loosely, weight on one leg, a relaxed candid smile, looking into the camera.",
  "Knees-up pose, adjusting his sleeve with both hands, eyes down on the cuff, a relaxed natural moment, not looking at the camera.",
];
const POSES_LOWER = [
  "Framed from the waist down, focus on the lower body and footwear, standing relaxed with weight on one leg and one foot slightly forward.",
  "Framed from the waist down, focus on the lower body and footwear, caught mid-stride in an easy natural walk.",
  "Framed from the waist down, focus on the lower body and footwear, standing with feet slightly apart, one hand in his pocket.",
  "Framed from the waist down, focus on the lower body and footwear, seated with one ankle resting on the other knee.",
  "Framed from the waist down, focus on the lower body and footwear, stepping up onto a low ledge with one foot raised.",
];
const MOTIONS = [
  "The model laughs naturally with a warm genuine smile, relaxed shoulders and subtle head movement.",
  "The model shifts his weight, turns slightly toward the camera and gives a confident easy smile.",
  "The model adjusts his jacket cuff and looks up with a relaxed friendly expression, gentle motion.",
  "The model takes a small step forward in an easy natural walk with a light smile.",
  "The model runs a hand through his hair and gives a laid-back smile, calm natural movement.",
];

type Frame = "full" | "upper" | "lower";
type Kind = "garment" | "tie";
const CAT: Record<string, { wear: string; frame: Frame; kind: Kind }> = {
  Overhemden: { wear: "wearing THIS shirt, neatly styled with trousers", frame: "upper", kind: "garment" },
  Colberts: { wear: "wearing THIS blazer over a crisp white dress shirt, with matching trousers and black leather shoes", frame: "full", kind: "garment" },
  Truien: { wear: "wearing THIS knitwear over a crisp white shirt collar, with neat trousers", frame: "upper", kind: "garment" },
  Vesten: { wear: "wearing THIS cardigan over a shirt, with neat trousers", frame: "upper", kind: "garment" },
  Broeken: { wear: "wearing THESE trousers with a tucked crisp white dress shirt and leather shoes", frame: "full", kind: "garment" },
  Gilets: { wear: "wearing THIS waistcoat over a crisp white dress shirt, with matching trousers and leather shoes", frame: "full", kind: "garment" },
  Jassen: { wear: "wearing THIS coat over neat menswear, with trousers and leather shoes", frame: "full", kind: "garment" },
  "Polo-shirts": { wear: "wearing THIS polo shirt, styled with neat trousers", frame: "upper", kind: "garment" },
  "T-Shirts": { wear: "wearing THIS t-shirt, styled casually with neat trousers", frame: "upper", kind: "garment" },
  Schoenen: { wear: "wearing THESE shoes with well-fitted light grey trousers and a brown leather belt", frame: "lower", kind: "garment" },
  Stropdassen: { wear: "wearing THIS necktie neatly knotted over a crisp white dress shirt under a navy suit jacket", frame: "upper", kind: "tie" },
  Strikken: { wear: "wearing THIS bow tie with a crisp white dress shirt and a black tuxedo", frame: "upper", kind: "tie" },
};

const MODEL_REFS = [
  "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-a.jpg",
  "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-b.jpg",
  "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-c.jpg",
  "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-d.jpg",
  "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-e.jpg",
];

function poseFor(frame: Frame, i: number) {
  const pool = frame === "full" ? POSES_FULL : frame === "upper" ? POSES_UPPER : POSES_LOWER;
  return pool[i % pool.length];
}
function toFullRes(u: string) { try { const x = new URL(u); if (x.pathname.includes("/cdn/shop") || x.hostname.endsWith("shopify.com")) { x.searchParams.delete("width"); x.searchParams.delete("height"); } return x.toString(); } catch { return u; } }
function modelInputs(img: string, prompt: string, i: number) {
  return { product_image: toFullRes(img), prompt, output_format: "jpeg", face_reference: MODEL_REFS[i % MODEL_REFS.length], face_reference_mode: "match_reference" } as Record<string, unknown>;
}

async function safeFetch(url: string, init?: RequestInit) { try { return await fetch(url, init); } catch { return null; } }
async function poll(id: string, key: string) {
  for (let i = 0; i < 160; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const st = await safeFetch(`${API}/status/${id}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!st || !st.ok) continue;
    const j = await st.json();
    if (j.status === "completed" && j.output?.[0]) return j.output[0] as string;
    if (j.status === "failed") { console.error("    faalde:", JSON.stringify(j.error).slice(0, 160)); return null; }
  }
  return null;
}
async function run(model_name: string, inputs: any, key: string) {
  const s = await safeFetch(`${API}/run`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model_name, inputs }) });
  if (!s || !s.ok) { console.error("    start-fout", model_name, s?.status); return null; }
  const { id } = await s.json();
  return poll(id, key);
}
async function padTo45(buf: Buffer): Promise<Buffer> {
  try {
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 0, h = meta.height ?? 0;
    if (!w || !h) return buf;
    const target = 4 / 5, ratio = w / h;
    if (Math.abs(ratio - target) < 0.01) return buf;
    const { data } = await sharp(buf).extract({ left: 0, top: 0, width: 2, height: 2 }).raw().toBuffer({ resolveWithObject: true });
    const background = { r: data[0], g: data[1], b: data[2], alpha: 1 };
    if (ratio < target) { const tw = Math.round(h * target); const left = Math.floor((tw - w) / 2); return sharp(buf).extend({ left, right: tw - w - left, background }).jpeg({ quality: 90 }).toBuffer(); }
    const th = Math.round(w / target); const top = Math.floor((th - h) / 2); return sharp(buf).extend({ top, bottom: th - h - top, background }).jpeg({ quality: 90 }).toBuffer();
  } catch { return buf; }
}
async function toBlob(srcUrl: string, path: string, token: string, contentType: string) {
  const res = await safeFetch(srcUrl);
  if (!res || !res.ok) return null;
  let body: Buffer | ArrayBuffer = await res.arrayBuffer();
  if (contentType === "image/jpeg") body = await padTo45(Buffer.from(body));
  const blob = await put(path, body, { access: "public", token, contentType, allowOverwrite: true });
  return `${blob.url}?v=${Date.now()}`;
}
async function getCredits(key: string): Promise<number> {
  try { const r = await fetch(`${API}/credits`, { headers: { Authorization: `Bearer ${key}` } }); const j = await r.json(); const n = Number(j?.credits?.total); return Number.isFinite(n) ? n : 999999; } catch { return 999999; }
}

async function main() {
  const key = process.env.FASHN_API_KEY!;
  const token = (process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN)!;
  if (!key || !token) { console.error("env ontbreekt"); process.exit(1); }
  const limit = Math.max(1, Math.min(800, Number(process.argv[2]) || 50));
  const onlyCat = (process.argv[3] || "").trim();
  const cats = onlyCat ? [onlyCat] : Object.keys(CAT);
  const db = getDb();

  const queryRows = () => db.execute<{ id: string; handle: string; title: string; hg: string; img: string }>(sql`
    select p.id, p.handle, p.title, p.attributes->>'hoofdgroep_omschrijving' hg,
      (select url from product_images pi where pi.product_id=p.id order by position limit 1) img
    from products p
    where p.status='active' and p.has_image and p.in_stock and p.is_group_primary
      and p.model_image_url='' and p.attributes->>'hoofdgroep_omschrijving' in (${sql.join(cats.map((c) => sql`${c}`), sql`, `)})
    order by p.stock_qty desc limit ${limit}`);
  let rows: Awaited<ReturnType<typeof queryRows>> | null = null;
  for (let a = 1; a <= 6 && !rows; a++) {
    try { rows = await queryRows(); } catch (e) { console.error(`  DB-query poging ${a}/6…`, String((e as Error)?.message || e).slice(0, 80)); await new Promise((r) => setTimeout(r, 3000 * a)); }
  }
  if (!rows) { console.error("DB onbereikbaar — gestopt."); process.exit(1); }

  let credits = await getCredits(key);
  console.log(`⏳ ${rows.rows.length} producten — ${credits} credits.`);
  let done = 0, idx = 0;

  for (const r of rows.rows) {
    if (credits < 2) { console.log(`⛔ Credits op (${credits}).`); break; }
    const conf = CAT[r.hg];
    if (!conf || !r.img) { console.log(`• ${r.handle} — overslaan`); continue; }
    const i = idx++;
    console.log(`• ${r.handle} (${r.hg})`);
    try {
      const patch: Record<string, string> = {};
      const p1 = await run("product-to-model", modelInputs(r.img, `Male model ${conf.wear}. ${poseFor(conf.frame, i)} ${STUDIO}`, i), key);
      let leadUrl = "";
      if (p1) { const u = await toBlob(p1, `ai-models/${r.handle}-model.jpg`, token, "image/jpeg"); if (u) { patch.modelImageUrl = u; patch.modelImageAlt = `${r.title} — op model`; leadUrl = u; } }

      if (conf.kind === "garment" && leadUrl) {
        const vid = await run("image-to-video", { image: leadUrl, prompt: MOTIONS[i % MOTIONS.length], duration: 5, resolution: "720p" }, key);
        if (vid) { const u = await toBlob(vid, `ai-videos/${r.handle}.mp4`, token, "video/mp4"); if (u) patch.modelVideoUrl = u; }
      }

      if (Object.keys(patch).length) {
        let saved = false;
        for (let a = 1; a <= 4 && !saved; a++) { try { await db.update(products).set(patch).where(eq(products.id, r.id)); saved = true; } catch { await new Promise((rr) => setTimeout(rr, 2000 * a)); } }
        if (saved) { done++; console.log(`   ✓ ${Object.keys(patch).filter((k) => !k.endsWith("Alt")).join(", ")}`); }
      }
    } catch (e) {
      console.error(`   fout bij ${r.handle}, overslaan:`, String((e as Error)?.message || e).slice(0, 100));
    }
    credits = await getCredits(key);
  }
  console.log(`\n✓ Klaar — ${done} producten, ${credits} credits over.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
