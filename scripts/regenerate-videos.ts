import "@/lib/load-env";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Hergenereert de model-video's vanaf de NIEUWE modelpose (model_image_url, native
 * 4:5 + natuurlijke baseline). image-to-video erft de input-ratio → 4:5-video met
 * dezelfde natuurlijke man als de foto. 720p/5s (3 credits elk).
 *
 *   npx tsx scripts/regenerate-videos.ts            (alle producten met een video)
 *   npx tsx scripts/regenerate-videos.ts <handle>   (alleen dat product)
 */
const API = "https://api.fashn.ai/v1";
const CONC = 3;
const MOTIONS = [
  "The model laughs naturally with a warm genuine smile, relaxed shoulders and subtle head movement.",
  "The model shifts his weight, turns slightly toward the camera and gives a confident easy smile.",
  "The model adjusts his jacket cuff and looks up with a relaxed friendly expression, gentle motion.",
  "The model takes a small step forward in an easy natural walk with a light smile, arms swinging gently.",
  "The model runs a hand through his hair and gives a laid-back natural smile, calm movement.",
];

async function run(image: string, prompt: string, apiKey: string): Promise<string | null> {
  const start = await fetch(`${API}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model_name: "image-to-video", inputs: { image, prompt, duration: 5, resolution: "720p" } }),
  });
  if (!start.ok) return null;
  const { id } = await start.json();
  for (let i = 0; i < 160; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await fetch(`${API}/status/${id}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!st.ok) continue;
    const j = await st.json();
    if (j.status === "completed" && j.output?.[0]) return j.output[0] as string;
    if (j.status === "failed") return null;
  }
  return null;
}

type Row = { id: string; handle: string; title: string; m1: string };

async function main() {
  const apiKey = process.env.FASHN_API_KEY!;
  const token = (process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN)!;
  if (!apiKey || !token) { console.error("FASHN_API_KEY of blob-token ontbreekt"); process.exit(1); }
  const db = getDb();
  const only = (process.argv[2] || "").trim();

  const rows = (await db.execute<Row>(sql`
    select p.id, p.handle, p.title, split_part(p.model_image_url,'?',1) m1
    from products p
    where p.model_video_url <> '' and p.model_image_url <> ''
      ${only ? sql`and p.handle = ${only}` : sql``}
    order by p.handle`)).rows;

  console.log(`⏳ ${rows.length} video's hergenereren vanaf de nieuwe modelpose (720p/5s)…`);
  let done = 0, err = 0;

  async function worker(slice: Row[], wi: number) {
    for (let k = 0; k < slice.length; k++) {
      const r = slice[k];
      if (!r.m1) { err++; done++; continue; }
      try {
        const out = await run(r.m1, MOTIONS[(wi + k) % MOTIONS.length], apiKey);
        if (!out) { err++; done++; continue; }
        const buf = Buffer.from(await (await fetch(out)).arrayBuffer());
        let saved = "";
        for (let a = 1; a <= 3 && !saved; a++) {
          try { const b = await put(`ai-videos/${r.handle}.mp4`, buf, { access: "public", token, contentType: "video/mp4", allowOverwrite: true }); saved = `${b.url}?v=${Date.now()}`; }
          catch { await new Promise((rr) => setTimeout(rr, 1500 * a)); }
        }
        if (!saved) { err++; done++; continue; }
        await db.update(products).set({ modelVideoUrl: saved }).where(eq(products.id, r.id));
      } catch { err++; }
      done++;
      if (done % 5 === 0) console.log(`  …${done}/${rows.length} (klaar ${done - err}, fout ${err})`);
    }
  }

  const chunks: Row[][] = Array.from({ length: CONC }, () => []);
  rows.forEach((r, i) => chunks[i % CONC].push(r));
  await Promise.all(chunks.map((c, i) => worker(c, i)));

  console.log(`\n✓ Klaar — ${done} verwerkt, ${err} fout.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
