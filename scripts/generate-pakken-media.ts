import "@/lib/load-env";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Rijke pakken-media via FASHN: per pak 2 modelposes + 1 detailfoto + 1 video
 * (720p/5s). Idempotent/hervatbaar — genereert alléén de ontbrekende stukken en
 * stopt netjes als de FASHN-credits opraken. 6 credits per volledig pak
 * (3 beeld + 3 video). De beelden leiden de PDP-galerij (modelpose1 → modelpose2
 * → detail → echte foto's), de video speelt vooraan.
 *
 *   npm run generate:pakken-media -- 14            (max 14 pakken deze run)
 *   npm run generate:pakken-media -- 1 pak-marron  (één pak gericht aanvullen)
 */

const API = "https://api.fashn.ai/v1";
const STUDIO = "Clean seamless studio background in a soft neutral light grey, soft even lighting, sharp high-end menswear e-commerce catalog quality. The shown product must stay accurate to the reference photo.";
const SUIT = "Male model wearing THIS suit, complete with a crisp white dress shirt and black leather oxford shoes.";
const POSE1 = `${SUIT} Relaxed full-length pose, one hand casually in his trouser pocket, weight on one leg, warm genuine smile, looking softly into the camera. ${STUDIO}`;
const POSE2 = `${SUIT} Easy full-length three-quarter stance, both hands loosely in his pockets, friendly relaxed smile, looking into the camera. ${STUDIO}`;
const DETAIL = `Close-up editorial detail shot of THIS suit worn by a man, framed from the shoulders to the waist with no face in frame, focus on the jacket lapel, chest pocket, buttons and fabric weave. ${STUDIO}`;
const MOTION = "Subtle natural movement: the model shifts his weight and turns slightly toward the camera, hands relaxed, gentle confident fashion-lookbook motion.";

function toFullRes(u: string) { try { const x = new URL(u); if (x.pathname.includes("/cdn/shop") || x.hostname.endsWith("shopify.com")) { x.searchParams.delete("width"); x.searchParams.delete("height"); } return x.toString(); } catch { return u; } }

async function poll(id: string, key: string, tries = 160) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const st = await fetch(`${API}/status/${id}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!st.ok) continue;
    const j = await st.json();
    if (j.status === "completed" && j.output?.[0]) return j.output[0] as string;
    if (j.status === "failed") { console.error("    faalde:", JSON.stringify(j.error).slice(0, 200)); return null; }
  }
  return null;
}

async function run(model_name: string, inputs: any, key: string) {
  const s = await fetch(`${API}/run`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model_name, inputs }) });
  if (!s.ok) { console.error("    start-fout", model_name, s.status, (await s.text()).slice(0, 200)); return null; }
  const { id } = await s.json();
  return poll(id, key);
}

async function toBlob(srcUrl: string, path: string, token: string, contentType: string) {
  const res = await fetch(srcUrl);
  if (!res.ok) return null;
  const blob = await put(path, await res.arrayBuffer(), { access: "public", token, contentType, allowOverwrite: true });
  return blob.url;
}

async function getCredits(key: string): Promise<number> {
  try { const r = await fetch(`${API}/credits`, { headers: { Authorization: `Bearer ${key}` } }); const j = await r.json(); return Number(j?.credits?.total ?? 0); } catch { return 0; }
}

async function main() {
  const key = process.env.FASHN_API_KEY!;
  const token = (process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN)!;
  if (!key || !token) { console.error("FASHN_API_KEY en blob-token nodig."); process.exit(1); }
  const limit = Math.max(1, Math.min(200, Number(process.argv[2]) || 14));
  const onlyHandle = (process.argv[3] || "").trim();
  const db = getDb();

  const rows = await db.execute<{ id: string; handle: string; title: string; img: string; m1: string; m2: string; det: string; vid: string }>(sql`
    select p.id, p.handle, p.title,
      (select url from product_images pi where pi.product_id=p.id order by position limit 1) img,
      p.model_image_url m1, p.model_image_url2 m2, p.detail_image_url det, p.model_video_url vid
    from products p
    where p.status='active' and p.has_image and p.in_stock and p.is_group_primary
      and p.attributes->>'hoofdgroep_omschrijving'='Pakken'
      ${onlyHandle ? sql`and p.handle=${onlyHandle}` : sql`and (p.model_image_url='' or p.model_image_url2='' or p.detail_image_url='' or p.model_video_url='')`}
    order by p.stock_qty desc
    limit ${limit}
  `);

  let credits = await getCredits(key);
  console.log(`⏳ ${rows.rows.length} pakken te verwerken — ${credits} credits beschikbaar.`);
  let done = 0, spent = 0;

  for (const r of rows.rows) {
    if (credits < 2) { console.log(`⛔ Credits op (${credits}). Gestopt — rest blijft staan voor de volgende run.`); break; }
    if (!r.img) { console.log(`• ${r.handle} — geen productfoto, overslaan`); continue; }
    console.log(`• ${r.handle}`);
    const patch: Record<string, string> = {};
    let leadUrl = r.m1;

    if (!r.m1) {
      const out = await run("product-to-model", { product_image: toFullRes(r.img), prompt: POSE1, output_format: "jpeg" }, key);
      if (out) { const u = await toBlob(out, `ai-models/${r.handle}-model.jpg`, token, "image/jpeg"); if (u) { patch.modelImageUrl = u; patch.modelImageAlt = `${r.title} — op model`; leadUrl = u; spent++; } }
    }
    if (!r.m2) {
      const out = await run("product-to-model", { product_image: toFullRes(r.img), prompt: POSE2, output_format: "jpeg" }, key);
      if (out) { const u = await toBlob(out, `ai-models/${r.handle}-model2.jpg`, token, "image/jpeg"); if (u) { patch.modelImageUrl2 = u; patch.modelImageAlt2 = `${r.title} — op model (2)`; spent++; } }
    }
    if (!r.det) {
      const out = await run("product-to-model", { product_image: toFullRes(r.img), prompt: DETAIL, output_format: "jpeg" }, key);
      if (out) { const u = await toBlob(out, `ai-models/${r.handle}-detail.jpg`, token, "image/jpeg"); if (u) { patch.detailImageUrl = u; patch.detailImageAlt = `${r.title} — detail`; spent++; } }
    }
    if (!r.vid && leadUrl) {
      const out = await run("image-to-video", { image: leadUrl, prompt: MOTION, duration: 5, resolution: "720p" }, key);
      if (out) { const u = await toBlob(out, `ai-videos/${r.handle}.mp4`, token, "video/mp4"); if (u) { patch.modelVideoUrl = u; spent += 3; } }
    }

    if (Object.keys(patch).length) {
      await db.update(products).set(patch).where(eq(products.id, r.id));
      done++;
      console.log(`   ✓ ${Object.keys(patch).filter((k) => k.endsWith("Url")).join(", ")}`);
    }
    credits = await getCredits(key);
  }

  console.log(`\n✓ Klaar — ${done} pakken bijgewerkt, ~${spent} credits gebruikt, ${credits} over.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
