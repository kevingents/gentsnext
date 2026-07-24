import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";

/**
 * AI-stijlgids (blog): GENTS-adviesartikelen mét echte producten. Een cron
 * genereert ~elke 2 weken een nieuw artikel (roterend onderwerp); Claude schrijft
 * on-brand, citeert UITSLUITEND meegegeven product-handles, en volgt onze
 * stijlregels (warm pak → bruine schoenen, wit kraag-overhemd, smoking → lakschoen).
 * Opslag: app_settings-rij `blogPosts` (lijst). Artikelen koppelen aan de
 * bijbehorende productpagina's via getBlogPostsForProduct.
 */
export type BlogSection = { heading: string; body: string; productHandles: string[] };
export type BlogPost = {
  slug: string;
  topicKey: string;
  title: string;
  excerpt: string;
  intro: string;
  sections: BlogSection[];
  productHandles: string[];
  heroImage: string;
  occasion?: string;
  author: string;
  publishedAt: string;
  seoTitle?: string;
  seoDescription?: string;
};

const ID = "blogPosts";

/** Roterende onderwerpen — elke cron pakt het volgende nog-niet-gebruikte. */
export const BLOG_TOPICS: { key: string; title: string; occasion?: string; hoofdgroepen: string[] }[] = [
  { key: "schoenen-onder-pak", title: "Welke schoenen draag je onder een pak?", hoofdgroepen: ["Schoenen", "Pakken"] },
  { key: "bruiloftsgast", title: "Perfect gekleed als bruiloftsgast", occasion: "Bruiloft", hoofdgroepen: ["Pakken", "Colberts", "Stropdassen"] },
  { key: "accessoires", title: "De finishing touch: das, pochet & accessoires", hoofdgroepen: ["Stropdassen", "Strikken", "Pochet", "Riemen"] },
  { key: "black-tie", title: "Black tie ontcijferd: de smoking compleet", occasion: "Gala", hoofdgroepen: ["Pakken", "Strikken", "Schoenen"] },
  { key: "kleuren-combineren", title: "Kleuren combineren in je pak-outfit", hoofdgroepen: ["Pakken", "Overhemden", "Stropdassen"] },
  { key: "zomerpak-linnen", title: "Zomers gekleed: linnen & lichte tinten", hoofdgroepen: ["Pakken", "Colberts"] },
  { key: "zakelijk-pak", title: "Het zakelijke pak: van boardroom tot borrel", occasion: "Zakelijk", hoofdgroepen: ["Pakken", "Overhemden"] },
  { key: "najaar-wol", title: "Najaar in wol, tweed & structuur", hoofdgroepen: ["Pakken", "Colberts", "Truien"] },
];

async function readStore(): Promise<BlogPost[]> {
  try {
    const db = getDb();
    const rows = await db.select().from(appSettings).where(eq(appSettings.id, ID)).limit(1);
    const data = rows[0]?.data as { posts?: BlogPost[] } | undefined;
    return Array.isArray(data?.posts) ? data!.posts! : [];
  } catch {
    return [];
  }
}

async function writeStore(posts: BlogPost[]): Promise<void> {
  const db = getDb();
  await db
    .insert(appSettings)
    .values({ id: ID, data: { posts }, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: appSettings.id, set: { data: { posts }, updatedAt: sql`now()` } });
}

export async function getBlogPosts(): Promise<BlogPost[]> {
  const posts = await readStore();
  return [...posts].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
}
export async function getBlogPost(slug: string): Promise<BlogPost | null> {
  return (await readStore()).find((p) => p.slug === slug) ?? null;
}
/** Artikelen waarin dit product voorkomt — voor de "In onze stijlgids"-link op de PDP. */
export async function getBlogPostsForProduct(handle: string): Promise<BlogPost[]> {
  if (!handle) return [];
  return (await getBlogPosts()).filter((p) => p.productHandles.includes(handle)).slice(0, 3);
}
export async function deleteBlogPost(slug: string): Promise<void> {
  await writeStore((await readStore()).filter((p) => p.slug !== slug));
}

/** Kies het volgende onderwerp dat nog geen (of het oudste) artikel heeft. */
function nextTopic(existing: BlogPost[]): (typeof BLOG_TOPICS)[number] {
  const used = new Set(existing.map((p) => p.topicKey));
  const fresh = BLOG_TOPICS.find((t) => !used.has(t.key));
  if (fresh) return fresh;
  // Alles al eens gehad → het onderwerp met het oudste artikel verversen.
  const oldestByTopic = [...existing].sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : 1))[0];
  return BLOG_TOPICS.find((t) => t.key === oldestByTopic?.topicKey) || BLOG_TOPICS[0];
}

type ProductLite = { handle: string; title: string; color: string; hoofdgroep: string; modelImageUrl: string };

async function pickProducts(hoofdgroepen: string[]): Promise<ProductLite[]> {
  const db = getDb();
  const rows = await db.execute<{ handle: string; title: string; vcl: string | null; hg: string; img: string }>(sql`
    select handle, title, coalesce(variant_color_label,'') vcl, attributes->>'hoofdgroep_omschrijving' hg, coalesce(model_image_url,'') img
    from products
    where status='active' and in_stock and is_group_primary
      and attributes->>'hoofdgroep_omschrijving' in (${sql.join(hoofdgroepen.map((h) => sql`${h}`), sql`, `)})
    order by stock_qty desc limit 14`);
  return rows.rows.map((r) => ({ handle: r.handle, title: r.title, color: r.vcl ?? "", hoofdgroep: r.hg || "", modelImageUrl: r.img }));
}

const SYSTEM = `Je bent de stylist-redacteur van GENTS Herenmode (premium, betaalbare luxe, formele momenten; persoonlijk advies in 19 winkels). Schrijf een stijlvol, behulpzaam adviesartikel in het Nederlands.
REGELS:
- Gebruik UITSLUITEND de meegegeven producten (verwijs via hun handle). Verzin GEEN andere producten, merken of feiten.
- Volg de GENTS-stijlregels: warm/gekleurd pak (zand, koraal, groen, bordeaux, bruin) → cognac/bruine schoenen; antraciet/zwart of black-tie → zwarte (lak)schoen; altijd een wit overhemd met kraag onder een pak; smoking → lakschoen + strik; gilet onderste knoop open.
- Toon: warm, deskundig, niet schreeuwerig. 3-5 secties, elk met 1-3 gekoppelde producten (handles).
- Verander NOOIT de merknaam.
- TAAL-QA: vlekkeloos Nederlands — geen Engelse of Duitse restwoorden (geen "warmth", "starched", "mutige"), geen half-vertaalde termen ("Zwart-tie" moet "Black tie" zijn), kloppende lidwoorden. Vaktermen die WEL mogen: black tie, white tie, smoking, dresscode, slim fit, suède, navy. Kleuren in het Nederlands (cognac, niet "tan"). Lees je tekst na alsof een taalpurist meeleest.
Antwoord ALLEEN met JSON:
{"title":"...","excerpt":"1 zin","intro":"1-2 alinea's","sections":[{"heading":"...","body":"1-2 alinea's","productHandles":["handle1"]}],"seoTitle":"max 60 tekens","seoDescription":"140-160 tekens"}`;

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/** Genereert + bewaart één blogartikel (gegeven of volgend onderwerp). Claude + echte producten. */
export async function generateBlogPost(topicKey?: string): Promise<BlogPost | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const existing = await readStore();
  const topic = topicKey ? BLOG_TOPICS.find((t) => t.key === topicKey) || nextTopic(existing) : nextTopic(existing);
  const products = await pickProducts(topic.hoofdgroepen);
  if (products.length < 3) return null;

  const productList = products.map((p) => `- handle:${p.handle} | ${p.title} | kleur:${p.color || "?"} | ${p.hoofdgroep}`).join("\n");
  const userMsg = `Onderwerp: ${topic.title}${topic.occasion ? ` (gelegenheid: ${topic.occasion})` : ""}.\n\nBeschikbare producten (gebruik alleen deze handles):\n${productList}`;

  let parsed: { title: string; excerpt: string; intro: string; sections: { heading: string; body: string; productHandles: string[] }[]; seoTitle?: string; seoDescription?: string } | null = null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.CONTENT_MODEL || process.env.SUPPORT_MODEL || "claude-haiku-4-5-20251001", max_tokens: 2000, system: SYSTEM, messages: [{ role: "user", content: userMsg }] }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const m = (j?.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed.title !== "string") return null;

  const valid = new Set(products.map((p) => p.handle));
  const sections: BlogSection[] = (parsed.sections || [])
    .map((s) => ({ heading: String(s.heading || "").slice(0, 120), body: String(s.body || "").slice(0, 2000), productHandles: (s.productHandles || []).filter((h) => valid.has(h)) }))
    .filter((s) => s.heading && s.body);
  const usedHandles = [...new Set(sections.flatMap((s) => s.productHandles))];
  const hero = products.find((p) => usedHandles.includes(p.handle) && p.modelImageUrl)?.modelImageUrl || products.find((p) => p.modelImageUrl)?.modelImageUrl || "";

  // Unieke slug (onderwerp + volgnummer als 't al bestaat).
  let slug = slugify(parsed.title) || topic.key;
  if (existing.some((p) => p.slug === slug)) slug = `${slug}-${existing.length + 1}`;

  const post: BlogPost = {
    slug,
    topicKey: topic.key,
    title: String(parsed.title).slice(0, 160),
    excerpt: String(parsed.excerpt || "").slice(0, 240),
    intro: String(parsed.intro || "").slice(0, 2000),
    sections,
    productHandles: usedHandles,
    heroImage: hero,
    occasion: topic.occasion,
    author: "GENTS Stylist",
    publishedAt: new Date().toISOString(),
    seoTitle: parsed.seoTitle ? String(parsed.seoTitle).slice(0, 200) : undefined,
    seoDescription: parsed.seoDescription ? String(parsed.seoDescription).slice(0, 320) : undefined,
  };
  await writeStore([post, ...existing].slice(0, 200));
  return post;
}
