import { list } from "@vercel/blob";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { hasDirectiveProvider, toDirective } from "@/lib/feedback-directive";

/**
 * Lerende sfeerbeeld-AI: de "learnings-store". Medewerkers keuren sfeerbeelden
 * af met een categorie + eigen notitie, of markeren ze als top; die feedback
 * stuurt de volgende sfeerbeeld-prompt aan.
 *
 * Drie onderwerpen (topic):
 *   - "beeld"   → de foto zelf (achtergrond, sfeer, belichting, compositie);
 *   - "model"   → de man op de foto;
 *   - "kleding" → het kledingstuk en de outfit eromheen.
 *
 * Deze store had dezelfde drie problemen als de modellen-studio, en die zijn nu
 * op dezelfde manier opgelost:
 *
 *  1. Alle feedback zat in één bak. Wat je bij één colbert opschreef ging mee in
 *     de prompt van élk product, en je nieuwste notitie verdronk tussen veertien
 *     oudere. De notitie bij een product telt nu als losse correctie voor dát
 *     product; vrije notities van andere producten blijven weg. Alleen de
 *     categorie-regels generaliseren nog, gecapt op de meest gemelde.
 *
 *  2. De notitie ging als "Also specifically avoid these noted problems:
 *     <NL-tekst>" de prompt in. Een beeldmodel kan niet ontkennen. Bij deze
 *     studio pakte dat extra hard uit, want de notities zijn hier vaak al als
 *     wens geschreven: "het is beter als de kraag een beetje open staat" werd
 *     letterlijk een instructie om een open kraag te vermijden. Elke notitie
 *     wordt nu omgezet naar een positieve Engelse instructie.
 *
 *  3. Opslag was een blob: hele bestand lezen, één regel erbij, alles terug-
 *     schrijven. Twee mensen die tegelijk beoordelen overschrijven elkaar. Nu
 *     één INSERT in Neon (tabel visual_learnings), net als model_learnings en om
 *     dezelfde reden — zie lib/bonnr-counter.ts voor wat die vorm ooit kostte.
 *
 * De tabel wordt lui aangemaakt zodat het werkt zodra de deploy live is;
 * drizzle/0052_visual-learnings.sql is de canonieke vorm. De oude blob wordt één
 * keer ingelezen (legacy_key + on conflict do nothing) en daarna genegeerd.
 */

const PATH = "visual-learnings/store.json";
const LEES_LIMIET = 500;

function blobToken(): string {
  return process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
}

export type LearningTopic = "beeld" | "model" | "kleding";

/**
 * Afkeur-categorieën: NL-label (UI) + EN-regel (prompt-injectie) + onderwerp.
 * De sleutels van de eerste acht liggen vast — ze staan zo in de bestaande
 * beoordelingen. De kleding-categorieën zijn nieuw: die feedback werd tot nu toe
 * onder "achtergrond" of "product" geparkeerd omdat er niets beters was.
 */
export const REJECT_CATEGORIES = {
  achtergrond: { topic: "beeld", label: "Achtergrond te druk/rommelig", rule: "the background must be simple, clean and uncluttered — never busy, cluttered or distracting" },
  sfeer: { topic: "beeld", label: "Verkeerde sfeer/uitstraling", rule: "the mood must be premium, calm and editorial, true to the GENTS menswear brand" },
  belichting: { topic: "beeld", label: "Belichting fout", rule: "soft, natural, on-brand lighting — never harsh, flat or artificial" },
  houding: { topic: "beeld", label: "Houding/compositie fout", rule: "a natural, relaxed, candid pose and a well-balanced composition" },
  kwaliteit: { topic: "beeld", label: "Algemene kwaliteit", rule: "sharp, high-quality, realistic editorial photography without artefacts" },
  model: { topic: "model", label: "Model/persoon klopt niet", rule: "show an ordinary, natural, real man with authentic real skin — never a glossy, flawless fashion model" },
  product: { topic: "kleding", label: "Product is veranderd", rule: "keep the shown product perfectly accurate to the reference photo — do not alter, redesign or restyle it" },
  kleur: { topic: "kleding", label: "Kleur klopt niet", rule: "keep the product colour exactly true to the reference product" },
  pasvorm: { topic: "kleding", label: "Pasvorm zit niet goed", rule: "the garment fits properly on the body — clean shoulder line, smooth chest, the way well-tailored menswear hangs" },
  dracht: { topic: "kleding", label: "Verkeerd gedragen (kraag, knopen, laagjes)", rule: "the garment is worn correctly: collar, buttons, cuffs and layering exactly as a well-dressed man would wear it" },
  combinatie: { topic: "kleding", label: "Rest van de outfit klopt niet", rule: "the rest of the outfit around the featured item must be coherent, classic menswear that suits the occasion" },
} as const satisfies Record<string, { topic: LearningTopic; label: string; rule: string }>;

export type RejectCategory = keyof typeof REJECT_CATEGORIES;

/** Categorieën voor de UI, mét onderwerp — de portal splitst hierop. */
export const REJECT_CATEGORY_LIST: { key: string; label: string; topic: LearningTopic }[] =
  Object.entries(REJECT_CATEGORIES).map(([key, v]) => ({ key, label: v.label, topic: v.topic }));

/** Onderwerp van een categorie. Oude beoordelingen (zonder topic) gaan hier doorheen. */
export function topicOf(category: string): LearningTopic {
  return REJECT_CATEGORIES[category as RejectCategory]?.topic || "beeld";
}

function ruleFor(category: string): string | null {
  return REJECT_CATEGORIES[category as RejectCategory]?.rule || null;
}

export type Learning = {
  handle?: string;
  slot?: number;
  url?: string;
  topic?: LearningTopic;
  category: string;
  reason: string;
  /** De notitie als positieve Engelse instructie — dít gaat de prompt in. */
  directive?: string;
  /** 'negative' = afgekeurd, 'positive' = top/geweldig (zo houden). */
  kind?: "positive" | "negative";
  at: string;
};

export type LearningsStore = { learnings: Learning[]; updatedAt: string | null };

const EMPTY: LearningsStore = { learnings: [], updatedAt: null };

let tabelKlaar = false;

async function zorgVoorTabel(): Promise<void> {
  if (tabelKlaar) return;
  const db = getDb();
  await db.execute(sql`
    create table if not exists visual_learnings (
      id bigserial primary key,
      handle text,
      slot integer,
      url text,
      topic text not null default 'beeld',
      category text not null,
      reason text not null default '',
      directive text,
      kind text not null default 'negative',
      at timestamptz not null default now(),
      legacy_key text unique
    )
  `);
  await db.execute(sql`create index if not exists visual_learnings_handle_idx on visual_learnings (handle)`);
  await db.execute(sql`create index if not exists visual_learnings_at_idx on visual_learnings (at desc)`);
  tabelKlaar = true;
  await importeerOudeBlob();
}

/** De beoordelingen die vóór de overstap in de blob stonden één keer overzetten. */
async function importeerOudeBlob(): Promise<void> {
  try {
    const db = getDb();
    const [rij] = (await db.execute<{ n: string }>(sql`select count(*) n from visual_learnings`)).rows;
    if (Number(rij?.n || 0) > 0) return;

    const { blobs } = await list({ prefix: PATH, limit: 1, token: blobToken() });
    const b = (blobs || []).find((x) => x.pathname === PATH);
    if (!b) return;
    const res = await fetch(`${b.url}?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as LearningsStore;
    const oud = Array.isArray(data?.learnings) ? data.learnings : [];
    if (!oud.length) return;

    for (const l of oud) {
      const category = String(l.category || "kwaliteit");
      const at = String(l.at || new Date().toISOString());
      await db.execute(sql`
        insert into visual_learnings (handle, slot, url, topic, category, reason, directive, kind, at, legacy_key)
        values (${l.handle || null}, ${Number.isFinite(Number(l.slot)) ? Number(l.slot) : null}, ${l.url || null},
                ${l.topic || topicOf(category)}, ${category}, ${String(l.reason || "")}, ${l.directive || null},
                ${l.kind === "positive" ? "positive" : "negative"}, ${at},
                ${`${at}|${l.handle || ""}|${l.slot ?? ""}|${category}|${String(l.reason || "").slice(0, 60)}`})
        on conflict (legacy_key) do nothing
      `);
    }
    console.info(`[visual-learnings] ${oud.length} oude beoordelingen uit de blob overgezet naar Neon.`);
  } catch (e) {
    console.warn("[visual-learnings] blob-import overgeslagen:", (e as Error).message);
  }
}

/** Lees de learnings-store (nieuwste eerst). */
export async function getVisualLearnings(): Promise<LearningsStore> {
  try {
    await zorgVoorTabel();
    const db = getDb();
    const rows = (await db.execute<{
      handle: string | null; slot: number | null; url: string | null; topic: string;
      category: string; reason: string; directive: string | null; kind: string; at: string;
    }>(sql`
      select handle, slot, url, topic, category, reason, directive, kind, at
      from visual_learnings order by at desc, id desc limit ${LEES_LIMIET}`)).rows;

    const learnings: Learning[] = rows.map((r) => ({
      handle: r.handle || undefined,
      slot: r.slot ?? undefined,
      url: r.url || undefined,
      topic: r.topic === "model" ? "model" : r.topic === "kleding" ? "kleding" : "beeld",
      category: r.category,
      reason: r.reason || "",
      directive: r.directive || undefined,
      kind: r.kind === "positive" ? "positive" : "negative",
      at: new Date(r.at).toISOString(),
    }));
    return { learnings, updatedAt: learnings[0]?.at || null };
  } catch (e) {
    // Neon onbereikbaar → genereren mag doorgaan met alleen de basisprompt.
    console.warn("[visual-learnings] lezen mislukt:", (e as Error).message);
    return { ...EMPTY };
  }
}

/** Voeg een beoordeling toe. Eén INSERT — geen lees-wijzig-schrijf, dus geen race. */
export async function addLearning(input: {
  handle?: string;
  slot?: number;
  url?: string;
  topic?: LearningTopic;
  category: string;
  reason: string;
  kind?: "positive" | "negative";
}): Promise<LearningsStore> {
  const category = String(input.category || "kwaliteit");
  const topic: LearningTopic =
    input.topic === "kleding" || input.topic === "model" || input.topic === "beeld" ? input.topic : topicOf(category);
  const reason = String(input.reason || "").trim().slice(0, 280);
  // Eerst de omzetting (die duurt een seconde), dán pas de database aanraken.
  const directive = (await toDirective(reason, category, topic)) || null;

  await zorgVoorTabel();
  const db = getDb();
  await db.execute(sql`
    insert into visual_learnings (handle, slot, url, topic, category, reason, directive, kind)
    values (${input.handle || null}, ${Number.isFinite(Number(input.slot)) ? Number(input.slot) : null},
            ${input.url || null}, ${topic}, ${category}, ${reason}, ${directive},
            ${input.kind === "positive" ? "positive" : "negative"})
  `);
  return getVisualLearnings();
}

/* ──────────────────────────── prompt-opbouw ──────────────────────────── */

const FOCUS_MAX = 6; // correcties voor DIT product
const HOUSE_MAX = 4; // generieke categorie-regels over alle beelden heen
const LIKED_MAX = 3;

/** Placeholder-teksten die geen echte feedback zijn en dus niet de prompt in hoeven. */
const NOISE = new Set(["goedgekeurd", "top", "ok", "oké", "prima", "goed", "mooi"]);
const meaningful = (s: string) => s.length > 2 && !NOISE.has(s.toLowerCase());
const uniq = (a: string[]) => [...new Set(a)];

/**
 * Bouwt het prompt-blok voor een nieuw sfeerbeeld.
 *
 * Met `handle`: de feedback op dít product wordt apart gezet als "must fix" —
 * het laatste wat de generator leest en het enige dat als correctie-opdracht
 * geformuleerd is. Vrije notities van ándere producten gaan niet mee; die
 * veroorzaakten de wijzigingen waar niemand om vroeg. Wat wél generaliseert zijn
 * de categorie-regels, gesorteerd op hoe vaak ze gemeld zijn.
 */
export function learningsPromptBlock(store: LearningsStore, opts: { handle?: string } = {}): string {
  if (!store.learnings.length) return "";
  const handle = opts.handle;
  const all = store.learnings.map((l) => ({ ...l, topic: l.topic || topicOf(l.category) }));
  const negatives = all.filter((l) => l.kind !== "positive");
  const positives = all.filter((l) => l.kind === "positive");
  const mine = handle ? negatives.filter((l) => l.handle === handle) : [];

  // Correcties voor dit product: per afkeuring één instructie — de omgezette
  // notitie, of anders de standaardregel van de categorie. De rúwe notitie is een
  // klacht en mag nooit als opdracht meegaan; kon hij niet omgezet worden, dan
  // gaat hij apart mee, expliciet gelabeld.
  const mineCats = uniq(mine.map((l) => l.category));
  const focusRaw: string[] = [];
  const complaintsRaw: string[] = [];
  for (const l of mine) {
    const directive = (l.directive || "").trim();
    if (meaningful(directive)) {
      focusRaw.push(directive);
      continue;
    }
    const rule = ruleFor(l.category);
    if (rule) focusRaw.push(rule);
    const raw = (l.reason || "").trim();
    if (meaningful(raw)) complaintsRaw.push(raw);
  }
  const focus = uniq(focusRaw).slice(0, FOCUS_MAX);
  const complaints = uniq(complaintsRaw).slice(0, FOCUS_MAX);

  // Huisregels: de meest gemelde categorieën over alle beelden heen, minus de
  // categorieën die hierboven al als correctie meegaan.
  const counts = new Map<string, number>();
  for (const l of negatives) counts.set(l.category, (counts.get(l.category) || 0) + 1);
  const houseRules = [...counts.entries()]
    .filter(([c]) => !mineCats.includes(c))
    .sort((a, b) => b[1] - a[1])
    .slice(0, HOUSE_MAX)
    .map(([c]) => ruleFor(c))
    .filter(Boolean) as string[];

  let block = "";
  if (houseRules.length) block += ` IMPORTANT — style rules learned from team feedback, STRICTLY follow: ${houseRules.join("; ")}.`;
  if (positives.length) {
    const liked = uniq(positives.map((l) => (l.directive || l.reason || "").trim()).filter(meaningful)).slice(0, LIKED_MAX);
    block += ` The team marked ${positives.length} earlier image(s) as EXCELLENT — match that premium, on-brand editorial quality and feel.`;
    if (liked.length) block += ` Specifically keep doing: ${liked.join("; ")}.`;
  }
  if (focus.length) {
    // "take priority": de outfit-beschrijving eerder in de prompt is hardgecodeerd
    // per hoofdgroep. Vraagt iemand juist om iets anders, dan moeten de twee niet
    // om voorrang vechten. Zie dezelfde ingreep in lib/model-learnings.ts.
    block += ` MOST IMPORTANT — our team reviewed earlier images of this exact product and asked for these corrections. The new image must show all of them, and they take priority over the outfit and styling described earlier in this prompt: ${focus.join("; ")}.`;
    if (complaints.length) {
      block += ` For context, their own words on what was wrong, written in Dutch — read them as complaints to fix, never as things to render: ${complaints.map((c) => `"${c}"`).join(", ")}.`;
    }
  }
  return block;
}

export { hasDirectiveProvider };
