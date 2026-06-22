import "@/lib/load-env";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Hergenereert model-video's vanaf de NIEUWE modelpose (model_image_url, native
 * 4:5). image-to-video erft de input-ratio → 4:5-video met dezelfde natuurlijke
 * man als de foto. 720p/5s (3 credits elk).
 *
 *   npx tsx scripts/regenerate-videos.ts            (alle producten met een video)
 *   npx tsx scripts/regenerate-videos.ts failed     (alleen video's die NIET in de
 *                                                     afgelopen 3u ververst zijn —
 *                                                     i.e. de gefaalde uit de vorige run)
 *   npx tsx scripts/regenerate-videos.ts <handle>   (alleen dat product)
 *
 * Robuust: ruim poll-venster (20 min, video's kunnen in de FASHN-wachtrij staan),
 * retry+backoff op start (429/5xx), en lagere gelijktijdigheid.
 */
const API = "https://api.fashn.ai/v1";
const CONC = 3;
const POLL_TRIES = 300; // ×4s ≈ 20 min — genoeg voor wachtrij + generatie
const MOTIONS = [
  "The model laughs naturally with a warm genuine smile, relaxed shoulders and subtle head movement.",
  "The model shifts his weight, turns slightly toward the camera and gives a confident easy smile.",
  "The model adjusts his jacket cuff and looks up with a relaxed friendly expression, gentle motion.",
  "The model takes a small step forward in an easy natural walk with a light smile, arms swinging gently.",
  "The model runs a hand through his hair and gives a laid-back natural smile, calm movement.",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function startJob(image: string, prompt: string, key: string, handle: string): Promise<string | null> {
  for (let a = 0; a < 4; a++) {
    let s: Response;
    try {
      s = await fetch(`${API}/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model_name: "image-to-video", inputs: { image, prompt, duration: 5, resolution: "720p" } }),
      });
    } catch {
      await sleep(5000 * (a + 1));
      continue;
    }
    if (s.ok) {
      const j = await s.json().catch(() => ({}));
      if (j.id) return j.id as string;
      return null;
    }
    if (s.status === 429 || s.status >= 500) { await sleep(6000 * (a + 1)); continue; } // throttle/transient → wachten
    const t = await s.text().catch(() => "");
    console.error(`  start-fout ${handle}: ${s.status} ${t.slice(0, 120)}`);
    return null;
  }
  console.error(`  start gaf op na retries: ${handle}`);
  return null;
}

async function generate(image: string, prompt: string, key: string, handle: string): Promise<string | null> {
  const id = await startJob(image, prompt, key, handle);
  if (!id) return null;
  for (let i = 0; i < POLL_TRIES; i++) {
    await sleep(4000);
    let j: { status?: string; output?: string[]; error?: unknown };
    try {
      const st = await fetch(`${API}/status/${id}`, { headers: { Authorization: `Bearer ${key}` } });
      if (!st.ok) continue;
      j = await st.json();
    } catch {
      continue;
    }
    if (j.status === "completed" && j.output?.[0]) return j.output[0];
    if (j.status === "failed") { console.error(`  faalde ${handle}: ${JSON.stringify(j.error).slice(0, 140)}`); return null; }
  }
  console.error(`  poll-timeout ${handle} (id ${id})`);
  return null;
}

type Row = { id: string; handle: string; title: string; m1: string };

async function main() {
  const apiKey = process.env.FASHN_API_KEY!;
  const token = (process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN)!;
  if (!apiKey || !token) { console.error("FASHN_API_KEY of blob-token ontbreekt"); process.exit(1); }
  const db = getDb();
  const arg = (process.argv[2] || "").trim();

  // "failed": alleen video's die niet in de afgelopen 3u ververst zijn (v=-timestamp).
  const cutoff = Date.now() - 3 * 3600 * 1000;
  const onlyFailed = arg === "failed";
  const onlyHandle = arg && arg !== "failed" ? arg : "";

  const rows = (
    await db.execute<Row>(sql`
      select p.id, p.handle, p.title, split_part(p.model_image_url, '?', 1) m1
      from products p
      where p.model_video_url <> '' and p.model_image_url <> ''
        ${onlyHandle ? sql`and p.handle = ${onlyHandle}` : sql``}
        ${onlyFailed ? sql`and coalesce(cast(nullif(split_part(p.model_video_url, 'v=', 2), '') as bigint), 0) < ${cutoff}` : sql``}
      order by p.handle`)
  ).rows;

  console.log(`⏳ ${rows.length} video's hergenereren vanaf de nieuwe modelpose (720p/5s)…`);
  let done = 0, err = 0;

  async function worker(slice: Row[], wi: number) {
    for (let k = 0; k < slice.length; k++) {
      const r = slice[k];
      if (!r.m1) { err++; done++; continue; }
      try {
        const out = await generate(r.m1, MOTIONS[(wi + k) % MOTIONS.length], apiKey, r.handle);
        if (!out) { err++; done++; continue; }
        const buf = Buffer.from(await (await fetch(out)).arrayBuffer());
        let saved = "";
        for (let a = 1; a <= 3 && !saved; a++) {
          try { const b = await put(`ai-videos/${r.handle}.mp4`, buf, { access: "public", token, contentType: "video/mp4", allowOverwrite: true }); saved = `${b.url}?v=${Date.now()}`; }
          catch { await sleep(1500 * a); }
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
