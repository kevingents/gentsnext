import "@/lib/load-env";
import { put } from "@vercel/blob";
import sharp from "sharp";
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
// Geroteerde pose-pool: niet elk pak dezelfde 2 poses (was hardcoded → eentonig).
// Per product 2 opeenvolgende, dus altijd verschillend, en verschoven over de catalogus.
const POSE_VARIANTS = [
  "Relaxed full-length pose, standing with one hand casually in his trouser pocket, weight on one leg, warm genuine smile, looking softly into the camera.",
  "Easy full-length three-quarter stance, both hands loosely in his pockets, friendly relaxed smile, looking into the camera.",
  "Full-length contrapposto, one hand on his hip and the other relaxed at his side, confident easy smile, looking into the camera.",
  "Candid full-length shot, caught mid-stride walking slowly toward the camera, relaxed shoulders, light spontaneous smile.",
  "Full-length editorial pose, leaning a shoulder lightly against a wall, hands relaxed, calm natural expression, glancing just off to the side.",
  "Full-length pose, half-turned away looking back over his shoulder toward the camera, one hand in pocket, a subtle confident smile.",
  "Full-length stance, arms loosely folded, weight on one leg, an easy candid smile, looking into the camera.",
  "Full-length pose, buttoning his jacket with both hands, eyes down on the button, a relaxed natural moment, not looking at the camera.",
];
const poseSuit = (i: number, slot: 0 | 1) => `${SUIT} ${POSE_VARIANTS[(i * 2 + slot) % POSE_VARIANTS.length]} ${STUDIO}`;
const DETAIL = `Close-up editorial detail of THIS suit, worn over a crisp white dress shirt with a buttoned collar — never a t-shirt — by a man. Tightly framed on the torso from the collarbone down to the waist; the head, chin and face are NOT in frame. Focus on the jacket lapel, chest pocket, buttons, the white shirt collar and the fabric texture. ${STUDIO}`;
// Geroteerde video-bewegingen voor diversiteit (lachen, klappen, anders poseren).
const MOTIONS = [
  "The model laughs naturally with a warm genuine smile, relaxed shoulders and subtle head movement.",
  "The model shifts his weight, turns slightly toward the camera and gives a confident easy smile.",
  "The model adjusts his jacket cuff and looks up with a relaxed friendly expression, gentle motion.",
  "The model brings his hands together in a relaxed clap and smiles, a casual lively gesture.",
  "The model takes a small step forward in an easy natural walk with a light smile, arms swinging gently.",
  "The model runs a hand through his hair and gives a laid-back smile, calm natural movement.",
];

// Vaste merk-modellen (blob-URL's), geroteerd voor diversiteit. Vul aan zodra de
// modellen klaar zijn (gebruiker levert er 2, ik genereer er 1). Leeg = FASHN
// kiest zelf een model (huidig gedrag).
const MODEL_REFS: string[] = [
  "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-a.jpg",
  "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-b.jpg",
  "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-c.jpg",
  "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-d.jpg",
  "https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/gents-models/brand-model-e.jpg",
];

/** product-to-model-inputs, met optioneel een vast merk-model via face_reference. */
function modelInputs(img: string, prompt: string, i: number) {
  const inputs: Record<string, unknown> = { product_image: toFullRes(img), prompt, output_format: "jpeg" };
  if (MODEL_REFS.length) {
    inputs.face_reference = MODEL_REFS[i % MODEL_REFS.length];
    inputs.face_reference_mode = "match_reference";
  }
  return inputs;
}

function toFullRes(u: string) { try { const x = new URL(u); if (x.pathname.includes("/cdn/shop") || x.hostname.endsWith("shopify.com")) { x.searchParams.delete("width"); x.searchParams.delete("height"); } return x.toString(); } catch { return u; } }

/** fetch met retry op transient netwerkfouten (DNS/timeout), zodat een blip de
 *  3-uurs-run niet laat crashen. Geeft null terug als het na de retries blijft falen. */
async function safeFetch(url: string, opts?: RequestInit, retries = 4): Promise<Response | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      if (i === retries) { console.error("    netwerk-fout (opgegeven):", String((e as Error)?.message || e).slice(0, 120)); return null; }
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  return null;
}

async function poll(id: string, key: string, tries = 160) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const st = await safeFetch(`${API}/status/${id}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!st || !st.ok) continue;
    const j = await st.json();
    if (j.status === "completed" && j.output?.[0]) return j.output[0] as string;
    if (j.status === "failed") { console.error("    faalde:", JSON.stringify(j.error).slice(0, 200)); return null; }
  }
  return null;
}

async function run(model_name: string, inputs: any, key: string) {
  const s = await safeFetch(`${API}/run`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model_name, inputs }) });
  if (!s || !s.ok) { console.error("    start-fout", model_name, s?.status, (s ? (await s.text()).slice(0, 200) : "geen response")); return null; }
  const { id } = await s.json();
  return poll(id, key);
}

/**
 * Pad een beeld naar exact 4:5 met z'n EIGEN randkleur (studio-grijs), zodat het
 * de 4:5-galerijtegel precies vult — geen "kader" (object-contain-opvulling) en
 * geen bijgesneden model. We samplen de hoek voor de opvulkleur, dus de naad valt
 * weg in de studio-achtergrond.
 */
async function padTo45(buf: Buffer): Promise<Buffer> {
  try {
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 0, h = meta.height ?? 0;
    if (!w || !h) return buf;
    const target = 4 / 5; // breedte/hoogte
    const ratio = w / h;
    if (Math.abs(ratio - target) < 0.01) return buf;
    const { data } = await sharp(buf).extract({ left: 0, top: 0, width: 2, height: 2 }).raw().toBuffer({ resolveWithObject: true });
    const background = { r: data[0], g: data[1], b: data[2], alpha: 1 };
    if (ratio < target) {
      const tw = Math.round(h * target);
      const left = Math.floor((tw - w) / 2);
      return sharp(buf).extend({ left, right: tw - w - left, top: 0, bottom: 0, background }).jpeg({ quality: 90 }).toBuffer();
    }
    const th = Math.round(w / target);
    const top = Math.floor((th - h) / 2);
    return sharp(buf).extend({ top, bottom: th - h - top, left: 0, right: 0, background }).jpeg({ quality: 90 }).toBuffer();
  } catch {
    return buf;
  }
}

async function toBlob(srcUrl: string, path: string, token: string, contentType: string) {
  const res = await safeFetch(srcUrl);
  if (!res || !res.ok) return null;
  let body: Buffer | ArrayBuffer = await res.arrayBuffer();
  if (contentType === "image/jpeg") body = await padTo45(Buffer.from(body));
  const blob = await put(path, body, { access: "public", token, contentType, allowOverwrite: true });
  // Cache-bust: zelfde blob-pad wordt overschreven, maar een unieke ?v dwingt
  // Next/Image om het verse beeld op te halen i.p.v. de oude (gecachte) versie.
  return `${blob.url}?v=${Date.now()}`;
}

async function getCredits(key: string): Promise<number> {
  // Bij een transient fout NIET 0 teruggeven (dat zou de credit-stop onterecht
  // triggeren) — geef een hoog getal, zodat alleen een ECHTE 0 de bulk stopt.
  try {
    const r = await fetch(`${API}/credits`, { headers: { Authorization: `Bearer ${key}` } });
    const j = await r.json();
    const n = Number(j?.credits?.total);
    return Number.isFinite(n) ? n : 999999;
  } catch { return 999999; }
}

async function main() {
  const key = process.env.FASHN_API_KEY!;
  const token = (process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN)!;
  if (!key || !token) { console.error("FASHN_API_KEY en blob-token nodig."); process.exit(1); }
  const limit = Math.max(1, Math.min(200, Number(process.argv[2]) || 14));
  const onlyHandle = (process.argv[3] || "").trim();
  const db = getDb();

  const queryRows = () => db.execute<{ id: string; handle: string; title: string; img: string; m1: string; m2: string; det: string; vid: string }>(sql`
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
  // Eerste DB-query met meerdere retries + backoff (Neon-verbinding kan transient
  // falen; dit was de crash-oorzaak van een eerdere run).
  let rows: Awaited<ReturnType<typeof queryRows>> | null = null;
  for (let attempt = 1; attempt <= 6 && !rows; attempt++) {
    try {
      rows = await queryRows();
    } catch (e) {
      console.error(`    DB-query mislukt (poging ${attempt}/6), opnieuw…`, String((e as Error)?.message || e).slice(0, 100));
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  if (!rows) { console.error("DB blijft onbereikbaar — gestopt (idempotent: volgende run pakt 't op)."); process.exit(1); }

  let credits = await getCredits(key);
  console.log(`⏳ ${rows.rows.length} pakken te verwerken — ${credits} credits beschikbaar.`);
  let done = 0, spent = 0, idx = 0;

  for (const r of rows.rows) {
    if (credits < 2) { console.log(`⛔ Credits op (${credits}). Gestopt — rest blijft staan voor de volgende run.`); break; }
    if (!r.img) { console.log(`• ${r.handle} — geen productfoto, overslaan`); continue; }
    const i = idx++;
    console.log(`• ${r.handle}`);
    try {
    const patch: Record<string, string> = {};
    let leadUrl = r.m1;

    if (!r.m1) {
      const out = await run("product-to-model", modelInputs(r.img, poseSuit(i, 0), i), key);
      if (out) { const u = await toBlob(out, `ai-models/${r.handle}-model.jpg`, token, "image/jpeg"); if (u) { patch.modelImageUrl = u; patch.modelImageAlt = `${r.title} — op model`; leadUrl = u; spent++; } }
    }
    if (!r.m2) {
      const out = await run("product-to-model", modelInputs(r.img, poseSuit(i, 1), i), key);
      if (out) { const u = await toBlob(out, `ai-models/${r.handle}-model2.jpg`, token, "image/jpeg"); if (u) { patch.modelImageUrl2 = u; patch.modelImageAlt2 = `${r.title} — op model (2)`; spent++; } }
    }
    if (!r.det) {
      const out = await run("product-to-model", modelInputs(r.img, DETAIL, i), key);
      if (out) { const u = await toBlob(out, `ai-models/${r.handle}-detail.jpg`, token, "image/jpeg"); if (u) { patch.detailImageUrl = u; patch.detailImageAlt = `${r.title} — detail`; spent++; } }
    }
    if (!r.vid && leadUrl) {
      const out = await run("image-to-video", { image: leadUrl, prompt: MOTIONS[i % MOTIONS.length], duration: 5, resolution: "720p" }, key);
      if (out) { const u = await toBlob(out, `ai-videos/${r.handle}.mp4`, token, "video/mp4"); if (u) { patch.modelVideoUrl = u; spent += 3; } }
    }

    if (Object.keys(patch).length) {
      let saved = false;
      for (let a = 1; a <= 4 && !saved; a++) {
        try { await db.update(products).set(patch).where(eq(products.id, r.id)); saved = true; }
        catch { await new Promise((rr) => setTimeout(rr, 2000 * a)); }
      }
      if (saved) { done++; console.log(`   ✓ ${Object.keys(patch).filter((k) => !k.endsWith("Alt")).join(", ")}`); }
      else console.error(`   opslaan ${r.handle} mislukt na retries — volgende run doet 't opnieuw`);
    }
    } catch (e) {
      console.error(`   fout bij ${r.handle}, overslaan:`, String((e as Error)?.message || e).slice(0, 120));
    }
    credits = await getCredits(key);
  }

  console.log(`\n✓ Klaar — ${done} pakken bijgewerkt, ~${spent} credits gebruikt, ${credits} over.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
