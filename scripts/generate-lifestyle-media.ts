import "@/lib/load-env";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * AI-lifestyle/sfeerbeelden per product → products.lifestyle_image_url. Everyman
 * (geen vast model), echte kreukels, 35mm-filmstijl, sfeer gematcht op het
 * producttype. Hero blijft ons echte product. Geen video, geen 4:5-padding (wordt
 * groot/ongecropt getoond). Robuust + cache-bust.
 *
 *   npm run gen:lifestyle -- 60 trouw     (Pakken/Colberts/Gilets — mediterrane bruiloft)
 *   npm run gen:lifestyle -- 30 polo      (Polo-shirts — vrolijk Palermo/Sardinie)
 *   npm run gen:lifestyle -- 40 country   (Truien/Jassen/Vesten — ruig Schotland)
 */

const API = "https://api.fashn.ai/v1";
const EVERYMAN = "An ordinary, natural-looking real man with authentic real skin texture and a genuine, relatable, slightly imperfect look — a real person, NOT a flawless fashion model. The fabric shows natural creases, folds and a lived-in look — NOT crisp, NOT perfectly pressed. Authentic candid editorial photo shot on 35mm film with visible natural grain, raw and real, a little imperfect — NOT glossy, NOT airbrushed, NOT studio-perfect. The shown product must stay accurate to the reference photo.";

const MOODS: Record<string, { light: string; scenes: string[] }> = {
  trouw: {
    light: "Warm golden-hour Mediterranean sunlight, sun-drenched.",
    scenes: [
      "walking mid-stride down the whitewashed steps of a South-European coastal village, turning to laugh over his shoulder, one hand in his pocket",
      "sitting back at a sun-dappled terrace cafe table with a cold drink, an arm draped over the chair, head tipped back mid-laugh",
      "standing on a stone harbour quay lined with traditional wooden boats, the sea behind, hands in pockets, glancing aside with a relaxed grin",
      "sitting on a large sun-warmed rock at the water's edge, forearms on his knees, a calm half-smile looking over the turquoise sea",
      "leaning casually against a sun-warmed whitewashed wall in a narrow Mediterranean street, hands in pockets, a relaxed natural half-smile",
      "with a small group of stylish male wedding guests on the village steps, laughing and talking, a natural candid group moment",
    ],
  },
  polo: {
    light: "Bright, cheerful, sunny summer light, vibrant and joyful.",
    scenes: [
      "laughing at a lively sun-soaked terrace cafe in Palermo, a cold drink on the table, colourful awnings and people around",
      "strolling a colourful bustling Palermo old-town street, candid and cheerful, warm tones and life all around",
      "by the bright turquoise Sardinian sea on a sunny day, relaxed and smiling, a carefree summer holiday feel",
      "sitting on sun-warmed harbour steps by the boats, laughing, a lively cheerful summer moment",
      "walking through a vibrant Sicilian market street, fruit stalls and colour around him, candid and full of life",
    ],
  },
  country: {
    light: "Moody, dramatic, overcast Scottish Highland light, atmospheric and cinematic.",
    scenes: [
      "standing on a windswept Scottish Highland moor covered in purple heather, rugged misty mountains behind, hands in pockets, looking over the wild landscape",
      "on a rugged grassy cliff edge above a stormy grey Scottish sea-loch, wind in his collar, a calm steady gaze into the distance",
      "walking a rough stone path through a dramatic Highland glen beside an ancient crumbling castle ruin, low mist and brooding sky",
      "beside a still Scottish loch with rugged hills and drifting low mist, quiet and contemplative",
    ],
  },
};

const CAT: Record<string, { mood: string; wear: string }> = {
  Pakken: { mood: "trouw", wear: "wearing THIS suit with a crisp white dress shirt and brown leather shoes" },
  Colberts: { mood: "trouw", wear: "wearing THIS blazer over a crisp white dress shirt with sand trousers and brown suede loafers" },
  Gilets: { mood: "trouw", wear: "wearing THIS waistcoat over a crisp white dress shirt with sand trousers and brown loafers" },
  "Polo-shirts": { mood: "polo", wear: "wearing THIS polo shirt with light sand chino trousers and brown suede loafers" },
  Truien: { mood: "country", wear: "wearing THIS knitwear with trousers and leather boots" },
  Vesten: { mood: "country", wear: "wearing THIS cardigan over a shirt with trousers and boots" },
  Jassen: { mood: "country", wear: "wearing THIS coat over a knit with trousers and leather boots" },
};
const PHASES: Record<string, string[]> = {
  trouw: ["Pakken", "Colberts", "Gilets"],
  polo: ["Polo-shirts"],
  country: ["Truien", "Vesten", "Jassen"],
};

function toFullRes(u: string) { try { const x = new URL(u); if (x.pathname.includes("/cdn/shop") || x.hostname.endsWith("shopify.com")) { x.searchParams.delete("width"); x.searchParams.delete("height"); } return x.toString(); } catch { return u; } }
async function safeFetch(url: string, init?: RequestInit) { try { return await fetch(url, init); } catch { return null; } }
async function poll(id: string, key: string) { for (let i = 0; i < 140; i++) { await new Promise((r) => setTimeout(r, 2500)); const st = await safeFetch(`${API}/status/${id}`, { headers: { Authorization: `Bearer ${key}` } }); if (!st || !st.ok) continue; const j = await st.json(); if (j.status === "completed" && j.output?.[0]) return j.output[0] as string; if (j.status === "failed") { console.error("    faalde:", JSON.stringify(j.error).slice(0, 160)); return null; } } return null; }
async function run(inputs: any, key: string) { const s = await safeFetch(`${API}/run`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model_name: "product-to-model", inputs }) }); if (!s || !s.ok) { console.error("    start-fout", s?.status); return null; } const { id } = await s.json(); return poll(id, key); }
async function toBlob(srcUrl: string, path: string, token: string) { const res = await safeFetch(srcUrl); if (!res || !res.ok) return null; const blob = await put(path, await res.arrayBuffer(), { access: "public", token, contentType: "image/jpeg", allowOverwrite: true }); return `${blob.url}?v=${Date.now()}`; }
async function getCredits(key: string): Promise<number> { try { const r = await fetch(`${API}/credits`, { headers: { Authorization: `Bearer ${key}` } }); const j = await r.json(); const n = Number(j?.credits?.total); return Number.isFinite(n) ? n : 999999; } catch { return 999999; } }

async function main() {
  const key = process.env.FASHN_API_KEY!;
  const token = (process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN)!;
  if (!key || !token) { console.error("env ontbreekt"); process.exit(1); }
  const limit = Math.max(1, Math.min(800, Number(process.argv[2]) || 40));
  const phase = (process.argv[3] || "trouw").trim();
  const cats = PHASES[phase] || (CAT[phase] ? [phase] : Object.keys(CAT));
  const db = getDb();

  const queryRows = () => db.execute<{ id: string; handle: string; title: string; hg: string; img: string }>(sql`
    select p.id, p.handle, p.title, p.attributes->>'hoofdgroep_omschrijving' hg,
      (select url from product_images pi where pi.product_id=p.id order by position limit 1) img
    from products p
    where p.status='active' and p.has_image and p.in_stock and p.is_group_primary
      and p.lifestyle_image_url='' and p.attributes->>'hoofdgroep_omschrijving' in (${sql.join(cats.map((c) => sql`${c}`), sql`, `)})
    order by p.stock_qty desc limit ${limit}`);
  let rows: Awaited<ReturnType<typeof queryRows>> | null = null;
  for (let a = 1; a <= 6 && !rows; a++) { try { rows = await queryRows(); } catch (e) { console.error(`  DB poging ${a}/6…`); await new Promise((r) => setTimeout(r, 3000 * a)); } }
  if (!rows) { console.error("DB onbereikbaar."); process.exit(1); }

  let credits = await getCredits(key);
  console.log(`⏳ ${rows.rows.length} producten (${phase}) — ${credits} credits.`);
  let done = 0, idx = 0;
  for (const r of rows.rows) {
    if (credits < 1) { console.log("⛔ Credits op."); break; }
    const conf = CAT[r.hg];
    const mood = conf ? MOODS[conf.mood] : MOODS.trouw;
    if (!conf || !r.img) { console.log(`• ${r.handle} — overslaan`); continue; }
    const i = idx++;
    const scene = mood.scenes[i % mood.scenes.length];
    console.log(`• ${r.handle} (${r.hg} · ${conf.mood})`);
    try {
      const prompt = `A man ${conf.wear}, ${scene}. ${mood.light} ${EVERYMAN}`;
      const out = await run({ product_image: toFullRes(r.img), prompt, output_format: "jpeg" }, key);
      if (out) {
        const u = await toBlob(out, `ai-lifestyle/${r.handle}.jpg`, token);
        if (u) {
          let saved = false;
          for (let a = 1; a <= 4 && !saved; a++) { try { await db.update(products).set({ lifestyleImageUrl: u, lifestyleImageAlt: `${r.title} — sfeerbeeld` }).where(eq(products.id, r.id)); saved = true; } catch { await new Promise((rr) => setTimeout(rr, 2000 * a)); } }
          if (saved) { done++; console.log("   ✓"); }
        }
      }
    } catch (e) { console.error(`   fout ${r.handle}:`, String((e as Error)?.message || e).slice(0, 100)); }
    credits = await getCredits(key);
  }
  console.log(`\n✓ Klaar — ${done} sfeerbeelden, ${credits} credits over.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
