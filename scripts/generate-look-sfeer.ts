import "@/lib/load-env";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { sql } from "drizzle-orm";
import { LOOKS } from "@/lib/looks";
import { modelStylePrompt } from "@/lib/model-styling";
import { getModelLearnings, modelLearningsBlock } from "@/lib/model-learnings";

/**
 * Genereert per look GELEGENHEID-passende sfeerbeelden (zakelijk→stad, gala→avond,
 * uitvaart→sober, bruiloft→zomerse tuin, …) i.p.v. de generieke categorie-mood.
 * Model draagt het hoofdgarment van de look in de juiste scène. Slaat 3 beelden per
 * look op in blob (ai-looks/<slug>-N.jpg) en schrijft de URLs naar app_settings
 * 'lookSfeer' → de looks-pagina pakt die automatisch op (hero + galerij).
 *
 *   npx tsx scripts/generate-look-sfeer.ts            (alle looks)
 *   npx tsx scripts/generate-look-sfeer.ts <slug>     (één look)
 */
const API = "https://api.fashn.ai/v1";
const CONC = 2;
const PER_LOOK = 3;
const GARMENT_PRIORITY = ["Pakken", "Colberts", "Jassen", "Gilets", "Broeken"];

const SCENE_BY_OCCASION: Record<string, { scene: string; light: string }> = {
  Zakelijk: { scene: "in a modern city business district with sleek glass office buildings behind him", light: "crisp clear daytime light, confident and professional" },
  Sollicitatie: { scene: "walking along a clean modern city street near office buildings", light: "bright morning light, confident and approachable" },
  Gala: { scene: "at an elegant evening gala inside a grand venue with warm chandeliers and soft bokeh", light: "warm low evening light, refined and festive" },
  Examengala: { scene: "at a stylish evening gala event in an elegant venue with soft bokeh lights", light: "warm evening light, festive and elegant" },
  Bruiloft: { scene: "as a guest at a summer wedding in a sunlit garden venue with greenery", light: "warm golden-hour light, joyful and elegant" },
  Communie: { scene: "at a bright spring celebration outdoors with blossoms and soft greenery", light: "fresh bright daylight, light and cheerful" },
  Feestdagen: { scene: "in a warm festive interior with soft candlelight and tasteful holiday ambiance", light: "cosy warm light, festive and intimate" },
  Uitvaart: { scene: "standing quietly outdoors in a calm, restrained and tasteful setting", light: "soft muted overcast light, sober and dignified, calm neutral expression, not smiling" },
};
const SCENE_BY_SLUG: Record<string, { scene: string; light: string }> = {
  "rokkostuum-compleet": { scene: "in a grand classical hall for a white-tie evening, marble and warm lamps", light: "warm formal evening light, very refined and stately" },
};
const DEFAULT_SCENE = { scene: "in an elegant, tasteful setting suited to a refined menswear moment", light: "soft natural light, premium editorial" };

const POSES = [
  "Full-length relaxed natural stance, one hand casually in his pocket, looking softly toward the camera.",
  "Full-length, taking an easy natural step, glancing just off to the side, relaxed and confident.",
  "Three-quarter length, adjusting his jacket cuff, a calm natural expression, candid moment.",
];

function garmentFor(hg: string, s: { shirt: string; shoes: string }): string {
  switch (hg) {
    case "Pakken": return `Male model wearing THIS suit, complete with ${s.shirt} and ${s.shoes}.`;
    case "Colberts": return `Male model wearing THIS blazer over ${s.shirt}, with matching trousers and ${s.shoes}.`;
    case "Gilets": return `Male model wearing THIS waistcoat over ${s.shirt}, with matching trousers and ${s.shoes}. The lowest button of the waistcoat is left open.`;
    case "Broeken": return `Male model wearing THESE trousers with a tucked ${s.shirt} and ${s.shoes}.`;
    case "Jassen": return "Male model wearing THIS coat over neat menswear, with trousers and leather shoes.";
    default: return `Male model wearing THIS item, neatly styled with ${s.shirt} and ${s.shoes}.`;
  }
}

/**
 * Wat de rest van de look moet tonen. Zonder dit beschreef de prompt alléén het
 * hoofdgarment en verzon het model de rest: bij "Driedelig klassiek" verdween
 * het gilet (tweedelig pak op de foto) en werd "Gala & black tie" een effen
 * zwart pak met wit overhemd — geen strik, geen satijnen revers.
 *
 * Volgorde = hoe je het aankleedt, van binnen naar buiten.
 */
const ROL_TEKST: Record<string, (titel: string) => string> = {
  Overhemden: () => "a crisp white dress shirt with a proper collar",
  Gilets: () => "a matching waistcoat in the same cloth, lowest button left open",
  Stropdassen: () => "a silk necktie",
  Strikken: () => "a black self-tie bow tie",
  Pochet: () => "a neatly folded pocket square",
  Broeken: () => "matching trousers of the same cloth",
  Riemen: () => "a leather belt",
  Schoenen: () => "polished leather shoes",
};

/**
 * Dresscode-regels per look. Deze staan LOS van de losse artikelen omdat ze
 * juist gaan over wat er NIET mag: een riem bij een smokingbroek, een stropdas
 * bij black tie, een rokvest zonder rokjas.
 */
const DRESSCODE: Record<string, string> = {
  "gala-black-tie":
    "Strict BLACK TIE: a black dinner jacket with satin peak lapels, a black self-tie bow tie (never a necktie), a white dress shirt, black patent leather shoes and NO belt.",
  "smoking-compleet":
    "Strict BLACK TIE: a black dinner jacket with satin lapels, a black self-tie bow tie (never a necktie), a pleated white dress shirt, black patent leather shoes and NO belt.",
  "rokkostuum-compleet":
    "Strict WHITE TIE: a black tailcoat worn OPEN over a white piqué waistcoat, a white wing-collar shirt, a white self-tie bow tie, black patent leather shoes and NO belt. The waistcoat is never worn without the tailcoat.",
  "driedelig-klassiek":
    "A THREE-PIECE suit: jacket, matching waistcoat and trousers in the same cloth. The waistcoat must be clearly visible under the open jacket, with its lowest button left open.",
  "communie-lentefeest":
    "A THREE-PIECE suit: jacket, matching waistcoat and trousers in the same cloth, the waistcoat clearly visible with its lowest button open.",
  examengala:
    "Formal evening wear: a dark dinner-style suit with a black bow tie and a white dress shirt, no necktie.",
  uitvaart:
    "Sober and correct: a dark suit, a white dress shirt, a plain dark necktie and black leather shoes. Nothing shiny or festive.",
};

/**
 * Beschrijft de héle look — het hoofdgarment zit al in de productfoto, de rest
 * benoemen we zodat het model 'm niet zelf invult.
 */
function outfitTekst(items: { hg: string; title: string }[], mainHandleHg: string): string {
  const gezien = new Set<string>([mainHandleHg]);
  const delen: string[] = [];
  for (const rol of Object.keys(ROL_TEKST)) {
    if (gezien.has(rol)) continue;
    const item = items.find((i) => i.hg === rol);
    if (!item) continue;
    gezien.add(rol);
    delen.push(ROL_TEKST[rol](item.title));
  }
  return delen.length ? ` The complete outfit also includes ${delen.join(", ")}.` : "";
}

async function run(productImage: string, prompt: string, key: string): Promise<string | null> {
  let s: Response;
  try {
    s = await fetch(`${API}/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model_name: "product-to-model", inputs: { product_image: productImage, prompt, output_format: "jpeg", aspect_ratio: "4:5" } }),
    });
  } catch { return null; }
  if (!s.ok) { console.error("  start-fout", s.status, (await s.text()).slice(0, 120)); return null; }
  const { id } = await s.json();
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    let j: { status?: string; output?: string[]; error?: unknown };
    try {
      const st = await fetch(`${API}/status/${id}`, { headers: { Authorization: `Bearer ${key}` } });
      if (!st.ok) continue;
      j = await st.json();
    } catch { continue; }
    if (j.status === "completed" && j.output?.[0]) return j.output[0];
    if (j.status === "failed") { console.error("  faalde", JSON.stringify(j.error).slice(0, 140)); return null; }
  }
  return null;
}

type Main = { handle: string; hg: string; vcl: string | null; title: string; img: string };

async function main() {
  const key = process.env.FASHN_API_KEY!;
  const token = (process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN)!;
  if (!key || !token) { console.error("FASHN_API_KEY of blob-token ontbreekt"); process.exit(1); }
  const db = getDb();
  const only = (process.argv[2] || "").trim();
  const looks = only ? LOOKS.filter((l) => l.slug === only) : LOOKS;

  // Hoofdgarment-handle per look bepalen.
  const order = (hg: string) => { const i = GARMENT_PRIORITY.indexOf(hg); return i < 0 ? 99 : i; };
  const allHandles = [...new Set(looks.flatMap((l) => l.hotspots.map((h) => h.handle)))];
  const rows = (
    await db.execute<Main>(sql`
      select p.handle, coalesce(p.attributes->>'hoofdgroep_omschrijving','') hg, p.variant_color_label vcl, p.title,
        (select pi.url from product_images pi where pi.product_id = p.id order by pi.position asc limit 1) img
      from products p
      where p.handle in (${sql.join(allHandles.map((h) => sql`${h}`), sql`, `)})
    `)
  ).rows;
  const byHandle = new Map(rows.map((r) => [r.handle, r]));
  const learn = modelLearningsBlock(await getModelLearnings());

  // Bestaande store lezen (zodat een enkele-slug-run de rest behoudt).
  const existing = (await db.execute<{ data: unknown }>(sql`select data from app_settings where id='lookSfeer' limit 1`)).rows[0]?.data as { looks?: Record<string, string[]> } | undefined;
  const store: Record<string, string[]> = existing?.looks && typeof existing.looks === "object" ? { ...existing.looks } : {};

  console.log(`⏳ ${looks.length} looks × ${PER_LOOK} sfeerbeelden…`);
  let done = 0, err = 0;

  async function worker(slice: typeof looks) {
    for (const look of slice) {
      const items = [...new Set(look.hotspots.map((h) => h.handle))]
        .map((h) => byHandle.get(h))
        .filter((r): r is Main => Boolean(r));
      const main = items.filter((r) => r.img).sort((a, b) => order(a.hg) - order(b.hg))[0];
      if (!main) { console.error(`  geen hoofdgarment voor ${look.slug}`); err++; continue; }
      const scene = SCENE_BY_SLUG[look.slug] || SCENE_BY_OCCASION[look.occasion] || DEFAULT_SCENE;
      const style = modelStylePrompt(main.hg, main.vcl, main.title, main.handle);
      // Hoofdgarment (uit de productfoto) + de rest van de look + de dresscode.
      // Alleen het hoofdgarment beschrijven leverde halve outfits op.
      const base = garmentFor(main.hg, style) + outfitTekst(items, main.hg);
      const regels = DRESSCODE[look.slug] ? ` ${DRESSCODE[look.slug]}` : "";
      const urls: string[] = [];
      for (let n = 0; n < PER_LOOK; n++) {
        const prompt = `${base}${regels} ${POSES[n % POSES.length]} The model is ${scene.scene}. ${scene.light}. Premium GENTS menswear editorial, authentic real natural man, candid moment, sharp high-end fashion photography.${learn}`;
        const out = await run(main.img, prompt, key);
        if (!out) { err++; continue; }
        try {
          const buf = Buffer.from(await (await fetch(out)).arrayBuffer());
          const b = await put(`ai-looks/${look.slug}-${n + 1}.jpg`, buf, { access: "public", token, contentType: "image/jpeg", allowOverwrite: true });
          urls.push(`${b.url}?v=${Date.now()}`);
        } catch { err++; }
      }
      if (urls.length) { store[look.slug] = urls; done++; console.log(`  ✓ ${look.slug} (${urls.length} beelden)`); }
    }
  }

  const chunks: (typeof looks)[] = Array.from({ length: CONC }, () => []);
  looks.forEach((l, i) => chunks[i % CONC].push(l));
  await Promise.all(chunks.map(worker));

  // Store wegschrijven (merge).
  await db
    .insert(appSettings)
    .values({ id: "lookSfeer", data: { looks: store }, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: appSettings.id, set: { data: { looks: store }, updatedAt: sql`now()` } });

  console.log(`\n✓ Klaar — ${done} looks gevuld, ${err} fout. Store: ${Object.keys(store).length} looks.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
