import "@/lib/load-env";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { newCollectionCond } from "@/lib/new-collection";

/**
 * AI-lifestyle/sfeerbeelden per product → products.lifestyle_image_url. Everyman
 * (geen vast model), echte kreukels, 35mm-filmstijl, sfeer gematcht op het
 * producttype. Hero blijft ons echte product. Geen video, geen 4:5-padding (wordt
 * groot/ongecropt getoond). Robuust + cache-bust.
 *
 *   npm run gen:lifestyle -- 60 trouw     (Pakken/Colberts/Gilets — mediterrane bruiloft)
 *   npm run gen:lifestyle -- 30 polo      (Polo-shirts — vrolijk Palermo/Sardinie)
 *   npm run gen:lifestyle -- 40 country   (Truien/Jassen/Vesten — ruig Schotland)
 *   npm run gen:lifestyle -- 320 stad     (Overhemden/Broeken/T-Shirts — smart-casual stad)
 *   npm run gen:lifestyle -- 20 student   (rok/jacquet — fatbike Amsterdam/Leiden)
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
      "on the sunlit whitewashed village steps just after the ceremony, adjusting a cuff, a natural candid moment",
      "at a relaxed casual outdoor beach wedding celebration at dusk, warm string lights and guests dancing behind, laughing with a drink in hand",
      "at a lively garden party among olive trees and flowers, a long festive table behind him, laughing mid-conversation with a glass in hand",
      "at a cheerful beach party by the sea at golden hour, a relaxed barefoot-on-the-sand summer vibe, a big carefree laugh",
      "raising a glass in a toast at a sunny vineyard terrace celebration, a long festive table beside him, a warm genuine laugh",
      "on the dance floor at an evening wedding party, jacket open, arms loose and up, mid-laugh under warm fairy lights",
      "raising a champagne glass on a sunlit rooftop terrace, the sea or skyline behind",
      "a quiet confident smile just after the ceremony, confetti drifting through the air",
      "walking with an easy confident stride along a golden-hour seaside promenade, hands relaxed",
      "leaning back against a balustrade at a late-afternoon reception, drink in hand, a relaxed contented smile",
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
      "lingering over an espresso at a tiny sunny piazza cafe, a folded newspaper on the marble table",
      "browsing a colourful morning flower market, warm sunlight streaming through the awnings",
      "stepping off a small wooden boat onto a sun-baked stone jetty, laughing, sea sparkling behind",
      "sitting at a shaded harbour-side table with a cold drink, lively, relaxed and laughing",
    ],
  },
  country: {
    light: "Moody, dramatic, overcast Scottish Highland light, atmospheric and cinematic.",
    scenes: [
      "standing on a windswept Scottish Highland moor covered in purple heather, rugged misty mountains behind, hands in pockets, looking over the wild landscape",
      "on a rugged grassy cliff edge above a stormy grey Scottish sea-loch, wind in his collar, a calm steady gaze into the distance",
      "walking a rough stone path through a dramatic Highland glen beside an ancient crumbling castle ruin, low mist and brooding sky",
      "beside a still Scottish loch with rugged hills and drifting low mist, quiet and contemplative",
      "warming his hands by a crackling fire pit outside a stone cottage at dusk, a dram of whisky in hand",
      "leaning on a weathered wooden fence beside a misty field with shaggy highland cattle behind",
      "sitting on the open tailgate of a mud-splashed vintage Land Rover on a rough moorland track",
      "crossing an old stone packhorse bridge over a rushing peat-brown Highland stream",
    ],
  },
  student: {
    light: "Bright natural Dutch daylight, lively, playful and a little funny.",
    scenes: [
      "riding a chunky fat-tyre e-bike (fatbike) along a sunny Amsterdam canal, tall narrow gabled canal houses and a humpback bridge behind, a big cheerful grin, caught mid-ride",
      "on a fatbike crossing a picturesque old canal bridge in historic Leiden, weathered Dutch brick buildings and bikes leaning on the railings, a lively candid student moment",
      "standing just outside a characterful old Dutch student-society building on a canal, candid and lively",
      "cycling a fatbike across a sunlit cobbled Dutch university-town square, an old bell-tower behind, cheerful and carefree",
      "sitting on the worn stone steps of a grand old university building, relaxed and cheerful",
      "raising a glass at a long candle-lit student-society dinner table, lively and a little rowdy",
      "walking his fatbike across a sunny canal bridge, relaxed and easy",
    ],
  },
  stad: {
    light: "Soft natural European city daylight, stylish, easy and relaxed.",
    scenes: [
      "sitting at a marble cafe table on a lively old-town terrace, espresso in hand, watching the street go by",
      "walking a sunlit cobbled city street past grand historic facades, relaxed and unhurried",
      "browsing a weekend vintage flea market among curious stalls, sunlight slanting between the awnings",
      "leaning on the wrought-iron balcony of an old city apartment in the morning light, coffee in hand",
      "crossing a grand city square past an old fountain, mid-stride, easy and quietly confident",
      "reading by the window of a cosy bookshop cafe, a flat white on the table",
      "stepping out of a classic barbershop onto a busy street, fresh, relaxed and smiling",
      "leaning on a sunlit canal bridge railing, watching the boats drift past below",
    ],
  },
};

const CAT: Record<string, { mood: string; wear: string }> = {
  Pakken: { mood: "trouw", wear: "wearing THIS suit with a crisp white dress shirt and brown leather shoes" },
  Colberts: { mood: "trouw", wear: "wearing THIS blazer over a crisp white dress shirt with sand trousers and brown suede loafers" },
  Gilets: { mood: "trouw", wear: "wearing THIS waistcoat over a crisp white dress shirt with sand trousers and brown loafers — the bottom button of the waistcoat is always left undone (open)" },
  "Polo-shirts": { mood: "polo", wear: "wearing THIS polo shirt with light sand chino trousers and brown suede loafers" },
  Truien: { mood: "country", wear: "wearing THIS knitwear with trousers and leather boots" },
  Vesten: { mood: "country", wear: "wearing THIS cardigan over a shirt with trousers and boots" },
  Jassen: { mood: "country", wear: "wearing THIS coat over a knit with trousers and leather boots" },
  Overhemden: { mood: "stad", wear: "wearing THIS shirt with the sleeves relaxed, light chino trousers and brown leather loafers" },
  Broeken: { mood: "stad", wear: "wearing THIS pair of trousers with a tucked-in light shirt and brown leather shoes" },
  "T-Shirts": { mood: "stad", wear: "wearing THIS t-shirt with light chino trousers, a relaxed summer city look" },
};
const PHASES: Record<string, string[]> = {
  trouw: ["Pakken", "Colberts", "Gilets"],
  polo: ["Polo-shirts"],
  country: ["Truien", "Vesten", "Jassen"],
  stad: ["Overhemden", "Broeken", "T-Shirts"],
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
  const redo = process.argv.includes("redo"); // overschrijf bestaande slots i.p.v. alleen lege vullen
  const onlyNew = process.argv.includes("new"); // alleen nieuwe collectie
  const isStudent = phase === "student";
  const cats = PHASES[phase] || (CAT[phase] ? [phase] : Object.keys(CAT));
  const db = getDb();

  // Normaal: alleen producten met ≥1 leeg slot. Redo: alle producten (overschrijf alles).
  const emptySlot = sql`and (p.lifestyle_image_url='' or p.lifestyle_image_url2='' or p.lifestyle_image_url3='')`;
  const newColl = onlyNew ? sql`and ${newCollectionCond}` : sql``;
  const base = sql`p.status='active' and p.has_image and p.in_stock and p.is_group_primary ${redo ? sql`` : emptySlot} ${newColl}`;
  const filter = isStudent
    ? sql`(lower(p.handle) like '%rok%' or lower(p.title) like '%rokkostuum%' or lower(p.title) like '%rokjas%' or lower(p.handle) like 'jacquet%' or lower(p.title) like '%jacquet%')`
    : sql`p.attributes->>'hoofdgroep_omschrijving' in (${sql.join(cats.map((c) => sql`${c}`), sql`, `)})`;
  const queryRows = () => db.execute<{ id: string; handle: string; title: string; hg: string; img: string; l1: string; l2: string; l3: string }>(sql`
    select p.id, p.handle, p.title, p.attributes->>'hoofdgroep_omschrijving' hg,
      (select url from product_images pi where pi.product_id=p.id order by position limit 1) img,
      p.lifestyle_image_url l1, p.lifestyle_image_url2 l2, p.lifestyle_image_url3 l3
    from products p
    where ${base} and ${filter}
    order by p.stock_qty desc limit ${limit}`);
  let rows: Awaited<ReturnType<typeof queryRows>> | null = null;
  for (let a = 1; a <= 6 && !rows; a++) { try { rows = await queryRows(); } catch (e) { console.error(`  DB poging ${a}/6…`); await new Promise((r) => setTimeout(r, 3000 * a)); } }
  if (!rows) { console.error("DB onbereikbaar."); process.exit(1); }

  let credits = await getCredits(key);
  console.log(`⏳ ${rows.rows.length} producten (${phase}) — ${credits} credits.`);
  let done = 0, idx = 0;
  for (const r of rows.rows) {
    if (credits < 1) { console.log("⛔ Credits op."); break; }
    const conf = isStudent
      ? { mood: "student", wear: "A cheerful young Dutch student wearing THIS formal item as part of a full white-tie tailcoat outfit — crisp white dress shirt, white bow tie and formal black trousers" }
      : CAT[r.hg];
    const mood = conf ? MOODS[conf.mood] : MOODS.trouw;
    if (!conf || !r.img) { console.log(`• ${r.handle} — overslaan`); continue; }
    const i = idx++;
    console.log(`• ${r.handle} (${r.hg} · ${conf.mood})`);
    try {
      const slots = [
        { col: "lifestyleImageUrl", cur: r.l1, path: `ai-lifestyle/${r.handle}.jpg` },
        { col: "lifestyleImageUrl2", cur: r.l2, path: `ai-lifestyle/${r.handle}-2.jpg` },
        { col: "lifestyleImageUrl3", cur: r.l3, path: `ai-lifestyle/${r.handle}-3.jpg` },
      ];
      const patch: Record<string, string> = {};
      for (let s = 0; s < 3; s++) {
        if (!redo && slots[s].cur) continue;
        if (credits < 1) break;
        const scene = mood.scenes[(i * 3 + s) % mood.scenes.length];
        const prompt = `A man ${conf.wear}, ${scene}. ${mood.light} ${EVERYMAN}`;
        const out = await run({ product_image: toFullRes(r.img), prompt, output_format: "jpeg" }, key);
        if (out) { const u = await toBlob(out, slots[s].path, token); if (u) patch[slots[s].col] = u; }
        credits = await getCredits(key);
      }
      if (patch.lifestyleImageUrl) patch.lifestyleImageAlt = `${r.title} — sfeerbeeld`;
      if (Object.keys(patch).length) {
        let saved = false;
        for (let a = 1; a <= 4 && !saved; a++) { try { await db.update(products).set(patch).where(eq(products.id, r.id)); saved = true; } catch { await new Promise((rr) => setTimeout(rr, 2000 * a)); } }
        if (saved) { done++; console.log(`   ✓ +${Object.keys(patch).filter((k) => k.startsWith("lifestyleImageUrl")).length}`); }
      }
    } catch (e) { console.error(`   fout ${r.handle}:`, String((e as Error)?.message || e).slice(0, 100)); }
  }
  console.log(`\n✓ Klaar — ${done} sfeerbeelden, ${credits} credits over.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
