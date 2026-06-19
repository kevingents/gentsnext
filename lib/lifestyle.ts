import { put, del } from "@vercel/blob";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { getVisualLearnings, learningsPromptBlock } from "@/lib/visual-learnings";

/**
 * Herbruikbare sfeerbeeld-generatie per product (FASHN product-to-model), met de
 * geleerde stijl-regels uit de learnings-store in de prompt. Geport uit
 * scripts/generate-lifestyle-media.ts zodat de "lerende sfeerbeeld-studio" één
 * slot opnieuw kan genereren vanuit een API-route. PUUR PREVIEW (lifestyle_image_url*).
 */

const API = "https://api.fashn.ai/v1";

const EVERYMAN =
  "An ordinary, natural-looking real man with authentic real skin texture and a genuine, relatable, slightly imperfect look — a real person, NOT a flawless fashion model. The fabric shows natural creases, folds and a lived-in look — NOT crisp, NOT perfectly pressed. Authentic candid editorial photo shot on 35mm film with visible natural grain, raw and real, a little imperfect — NOT glossy, NOT airbrushed, NOT studio-perfect. The shown product must stay accurate to the reference photo.";

const MOODS: Record<string, { light: string; scenes: string[] }> = {
  trouw: {
    light: "Warm golden-hour Mediterranean sunlight, sun-drenched.",
    scenes: [
      "walking mid-stride down the whitewashed steps of a South-European coastal village, turning to laugh over his shoulder, one hand in his pocket",
      "sitting back at a sun-dappled terrace cafe table with a cold drink, an arm draped over the chair, head tipped back mid-laugh",
      "standing on a stone harbour quay lined with traditional wooden boats, the sea behind, hands in pockets, glancing aside with a relaxed grin",
      "sitting on a large sun-warmed rock at the water's edge, forearms on his knees, a calm half-smile looking over the turquoise sea",
      "leaning casually against a sun-warmed whitewashed wall in a narrow Mediterranean street, hands in pockets, a relaxed natural half-smile",
      "at a relaxed casual outdoor beach wedding celebration at dusk, warm string lights and guests dancing behind, laughing with a drink in hand",
      "at a lively garden party among olive trees and flowers, a long festive table behind him, laughing mid-conversation with a glass in hand",
      "raising a glass in a toast at a sunny vineyard terrace celebration, a long festive table beside him, a warm genuine laugh",
      "on the dance floor at an evening wedding party, jacket open, arms loose and up, mid-laugh under warm fairy lights",
      "walking with an easy confident stride along a golden-hour seaside promenade, hands relaxed",
    ],
  },
  polo: {
    light: "Bright, cheerful, sunny summer light, vibrant and joyful.",
    scenes: [
      "laughing at a lively sun-soaked terrace cafe in Palermo, a cold drink on the table, colourful awnings and people around",
      "strolling a colourful bustling Palermo old-town street, candid and cheerful, warm tones and life all around",
      "by the bright turquoise Sardinian sea on a sunny day, relaxed and smiling, a carefree summer holiday feel",
      "sitting on sun-warmed harbour steps by the boats, laughing, a lively cheerful summer moment",
      "lingering over an espresso at a tiny sunny piazza cafe, a folded newspaper on the marble table",
      "stepping off a small wooden boat onto a sun-baked stone jetty, laughing, sea sparkling behind",
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
      "crossing an old stone packhorse bridge over a rushing peat-brown Highland stream",
    ],
  },
  student: {
    light: "Bright natural Dutch daylight, lively, playful and a little funny.",
    scenes: [
      "riding a chunky fat-tyre e-bike (fatbike) along a sunny Amsterdam canal, tall narrow gabled canal houses and a humpback bridge behind, a big cheerful grin, caught mid-ride",
      "on a fatbike crossing a picturesque old canal bridge in historic Leiden, weathered Dutch brick buildings behind, a lively candid student moment",
      "cycling a fatbike across a sunlit cobbled Dutch university-town square, an old bell-tower behind, cheerful and carefree",
      "raising a glass at a long candle-lit student-society dinner table, lively and a little rowdy",
    ],
  },
  stad: {
    light: "Soft natural European city daylight, stylish, easy and relaxed.",
    scenes: [
      "sitting at a marble cafe table on a lively old-town terrace, espresso in hand, watching the street go by",
      "walking a sunlit cobbled city street past grand historic facades, relaxed and unhurried",
      "browsing a weekend vintage flea market among curious stalls, sunlight slanting between the awnings",
      "crossing a grand city square past an old fountain, mid-stride, easy and quietly confident",
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

function blobToken(): string {
  return process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
}
function toFullRes(u: string): string {
  try {
    const x = new URL(u);
    if (x.pathname.includes("/cdn/shop") || x.hostname.endsWith("shopify.com")) {
      x.searchParams.delete("width");
      x.searchParams.delete("height");
    }
    return x.toString();
  } catch {
    return u;
  }
}
async function safeFetch(url: string, init?: RequestInit) {
  try {
    return await fetch(url, init);
  } catch {
    return null;
  }
}
async function poll(id: string, key: string): Promise<string | null> {
  for (let i = 0; i < 140; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const st = await safeFetch(`${API}/status/${id}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!st || !st.ok) continue;
    const j = await st.json();
    if (j.status === "completed" && j.output?.[0]) return j.output[0] as string;
    if (j.status === "failed") return null;
  }
  return null;
}
async function run(inputs: Record<string, unknown>, key: string): Promise<string | null> {
  const s = await safeFetch(`${API}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model_name: "product-to-model", inputs }),
  });
  if (!s || !s.ok) return null;
  const { id } = await s.json();
  return poll(id, key);
}
async function toBlob(srcUrl: string, path: string, token: string): Promise<string | null> {
  const res = await safeFetch(srcUrl);
  if (!res || !res.ok) return null;
  const blob = await put(path, await res.arrayBuffer(), { access: "public", token, contentType: "image/jpeg", allowOverwrite: true });
  return `${blob.url}?v=${Date.now()}`;
}

function blobPath(handle: string, slot: 1 | 2 | 3): string {
  return slot === 1 ? `ai-lifestyle/${handle}.jpg` : `ai-lifestyle/${handle}-${slot}.jpg`;
}

type ProdRow = { id: string; handle: string; title: string; hg: string; img: string; l1: string; l2: string; l3: string };

async function loadProduct(handle: string): Promise<ProdRow | null> {
  const db = getDb();
  const rows = await db.execute<ProdRow>(sql`
    select p.id, p.handle, p.title, p.attributes->>'hoofdgroep_omschrijving' hg,
      (select url from product_images pi where pi.product_id=p.id order by position limit 1) img,
      p.lifestyle_image_url l1, p.lifestyle_image_url2 l2, p.lifestyle_image_url3 l3
    from products p where p.handle=${handle} limit 1`);
  return rows.rows[0] || null;
}

/** Genereer één sfeerbeeld-slot (1|2|3) opnieuw, met de geleerde stijl-regels. */
export async function regenerateLifestyleSlot(handle: string, slot: 1 | 2 | 3): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const key = process.env.FASHN_API_KEY || "";
  const token = blobToken();
  if (!key) return { ok: false, error: "FASHN_API_KEY ontbreekt." };
  if (!token) return { ok: false, error: "Blob-token ontbreekt." };

  const r = await loadProduct(handle);
  if (!r) return { ok: false, error: "Product niet gevonden." };
  if (!r.img) return { ok: false, error: "Geen productfoto om op te baseren." };

  const isStudent = /\brok|jacquet/i.test(`${r.handle} ${r.title}`);
  const conf = isStudent
    ? { mood: "student", wear: "A cheerful young Dutch student wearing THIS formal item as part of a full white-tie tailcoat outfit — crisp white dress shirt, white bow tie and formal black trousers" }
    : CAT[r.hg];
  if (!conf) return { ok: false, error: `Geen sfeer-config voor hoofdgroep "${r.hg || "?"}".` };
  const mood = MOODS[conf.mood] || MOODS.trouw;
  const scene = mood.scenes[Math.floor(Math.random() * mood.scenes.length)];

  const learnings = await getVisualLearnings();
  const prompt = `A man ${conf.wear}, ${scene}. ${mood.light} ${EVERYMAN}${learningsPromptBlock(learnings)}`;

  const out = await run({ product_image: toFullRes(r.img), prompt, output_format: "jpeg" }, key);
  if (!out) return { ok: false, error: "FASHN-generatie mislukt." };
  const url = await toBlob(out, blobPath(handle, slot), token);
  if (!url) return { ok: false, error: "Upload naar blob mislukt." };

  const patch: Record<string, string> = {};
  if (slot === 1) { patch.lifestyleImageUrl = url; patch.lifestyleImageAlt = `${r.title} — sfeerbeeld`; }
  else if (slot === 2) patch.lifestyleImageUrl2 = url;
  else patch.lifestyleImageUrl3 = url;
  await getDb().update(products).set(patch).where(eq(products.id, r.id));

  return { ok: true, url };
}

/** Wis één sfeerbeeld-slot (db-veld leeg + blob verwijderen) — na afkeuren. */
export async function clearLifestyleSlot(handle: string, slot: 1 | 2 | 3): Promise<{ ok: boolean }> {
  const r = await loadProduct(handle);
  if (!r) return { ok: false };
  const cur = slot === 1 ? r.l1 : slot === 2 ? r.l2 : r.l3;
  const patch: Record<string, string> = {};
  if (slot === 1) { patch.lifestyleImageUrl = ""; patch.lifestyleImageAlt = ""; }
  else if (slot === 2) patch.lifestyleImageUrl2 = "";
  else patch.lifestyleImageUrl3 = "";
  await getDb().update(products).set(patch).where(eq(products.id, r.id));
  if (cur) { try { await del(cur.split("?")[0], { token: blobToken() }); } catch { /* blob al weg */ } }
  return { ok: true };
}
