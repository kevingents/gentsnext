import { list } from "@vercel/blob";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { hasDirectiveProvider, toDirective } from "@/lib/feedback-directive";

/**
 * Lerende modellen-AI: aparte "learnings-store" voor de modelfoto's, los van de
 * sfeerbeeld-learnings. Medewerkers keuren een foto goed/af met een categorie +
 * een eigen notitie; die feedback stuurt de volgende modelfoto-prompt aan.
 *
 * Twee onderwerpen (topic):
 *   - "model"   → de persoon op de foto (gezicht, leeftijd, pose, handen…);
 *   - "garment" → de kleding zelf (pasvorm, lengte, kleur, stof, details…).
 *
 * Waarom feedback eerder nauwelijks effect had — en wat er nu anders is:
 *
 *  1. Álle feedback was globaal. Een notitie bij één foto ging mee in de prompt
 *     van élk product, en de notitie die je zojuist gaf verdronk tussen veertien
 *     oudere. Nu telt de notitie bij DIT product als aparte, hoogste-prioriteit
 *     "must fix"-regel, en gaan vrije notities van ándere foto's niet meer mee —
 *     precies die veroorzaakten de wijzigingen waar niemand om had gevraagd.
 *     Alleen de generieke categorie-regels generaliseren nog over foto's heen,
 *     en daarvan houden we de drie meest gemelde over in plaats van alle negen.
 *
 *  2. De notitie ging als "Specifically avoid: <NL-tekst>" de prompt in. Een
 *     beeldmodel kan niet ontkennen: noem je "te lange mouwen", dan krijg je te
 *     lange mouwen. Elke notitie wordt daarom bij het opslaan omgezet naar één
 *     POSITIEVE Engelse instructie (`directive`) — wat de foto wél moet tonen.
 *     Zonder ANTHROPIC/OPENAI-key valt hij terug op de ruwe notitie.
 *
 * Opslag = Neon (tabel model_learnings), niet meer de blob.
 *
 * WAAROM Neon: de blob-versie las het hele bestand, plakte er één regel bij en
 * schreef alles terug. Twee mensen die tegelijk een foto beoordelen lezen dan
 * dezelfde versie en de laatste schrijver gooit de ander weg — precies wat op
 * 6 aug 2026 met de SRS-bonnummerteller misging (zie lib/bonnr-counter.ts: een
 * stale blob-lees gaf twee keer 900001 en een verkoop van €249,90 verdween
 * stil). Bij feedback op foto's kost dat geen geld, maar wél het vertrouwen dat
 * de tool luistert: je typt iets, het lijkt opgeslagen, en het is weg. Sinds de
 * notitie onderweg ook nog door een AI-omzetting gaat zit er bovendien een hele
 * seconde tussen lezen en schrijven — het venster werd juist groter.
 *
 * Eén INSERT lost dat volledig op: geen lees-wijzig-schrijf, geen race, geen
 * CDN-cache tussen jou en je eigen feedback.
 *
 * De tabel wordt lui aangemaakt (create table if not exists), zoals de
 * bonnummerteller, zodat dit werkt zodra de deploy live is — migraties lopen
 * hier bewust niet automatisch mee met de build. drizzle/0051_model-learnings.sql
 * is de canonieke vorm. De oude blob wordt bij de eerste aanraking één keer
 * ingelezen (legacy_key + on conflict do nothing, dus dubbel draaien is
 * onschadelijk) en daarna met rust gelaten.
 */
const PATH = "model-learnings/store.json";

function blobToken(): string {
  return process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
}

/** Afkeur-categorieën voor het MODEL (de persoon): NL-label (UI) + EN-regel (prompt-injectie). */
export const MODEL_REJECT_CATEGORIES = {
  teperfect: { label: "Te perfect / te glad", rule: "show a natural, real, relatable man with authentic skin texture and subtle natural imperfections — NEVER a glossy, flawless, heavily-retouched fashion model" },
  gezicht: { label: "Gezicht klopt niet", rule: "a natural, believable face with a genuine, relaxed, warm expression" },
  leeftijd: { label: "Verkeerde leeftijd", rule: "an age-appropriate model that matches the GENTS customer (typically 30-55)" },
  bouw: { label: "Lichaamsbouw / postuur", rule: "a normal, realistic male build and posture — not exaggerated, not idealised" },
  pose: { label: "Houding / pose fout", rule: "a natural, relaxed, confident pose — never stiff, awkward or over-posed" },
  haar: { label: "Haar / baard klopt niet", rule: "natural, well-groomed hair and beard, true to a real man" },
  handen: { label: "Handen / anatomie fout", rule: "anatomically correct hands, fingers and proportions — no AI artefacts" },
  uitstraling: { label: "Uitstraling niet on-brand", rule: "a premium yet approachable, authentic GENTS look — refined, never artificial" },
  kwaliteit: { label: "Algemene kwaliteit", rule: "sharp, realistic editorial photography without AI artefacts" },
} as const;

/**
 * Afkeur-categorieën voor de KLEDING zelf — het product zoals het gedragen op de
 * foto staat. Deze regels landen in het kleding-deel van de prompt (vlak achter
 * de zin die het kledingstuk beschrijft), niet bij de beschrijving van de man.
 */
export const GARMENT_REJECT_CATEGORIES = {
  pasvorm: { label: "Pasvorm zit niet goed", rule: "the garment must fit properly on the body — clean shoulder line, smooth chest, no pulling and no ballooning, the way well-tailored menswear hangs" },
  lengte: { label: "Lengte klopt niet (mouw / broek / jas)", rule: "classic menswear proportions: the jacket covers the seat, sleeves end at the wrist bone with a sliver of shirt cuff showing, trousers break lightly on the shoe" },
  kleurweergave: { label: "Kleur wijkt af van het product", rule: "the garment colour must match the reference product photo exactly, under neutral white-balanced light" },
  stof: { label: "Stof / structuur klopt niet", rule: "reproduce the fabric of the reference photo exactly — same weave, texture, sheen and drape" },
  details: { label: "Details kloppen niet (knopen, kraag, zakken)", rule: "reproduce every construction detail of the reference garment exactly: button stance, lapel and collar shape, pockets, vents and stitching — invent nothing" },
  kreukels: { label: "Kreukels / slordig gedragen", rule: "the garment is worn crisply and neatly: correctly buttoned, collar straight, fabric smooth and free of creases" },
  styling: { label: "Styling eromheen klopt niet", rule: "the surrounding menswear stays classic, neutral and subordinate to the featured item" },
  combinatie: { label: "Verkeerd gecombineerd", rule: "combine the item by GENTS menswear etiquette: a crisp white collared shirt, neat matching trousers and leather shoes in the prescribed colour" },
  anderitem: { label: "Toont niet hetzelfde product", rule: "the featured garment must be THE EXACT item from the reference photo — same model, colour, pattern and details, never a lookalike" },
} as const;

export type ModelRejectCategory = keyof typeof MODEL_REJECT_CATEGORIES;
export type GarmentRejectCategory = keyof typeof GARMENT_REJECT_CATEGORIES;
export type LearningTopic = "model" | "garment";

/** Alle categorieën voor de UI, mét onderwerp — de portal splitst hierop. */
export const REJECT_CATEGORIES: { key: string; label: string; topic: LearningTopic }[] = [
  ...Object.entries(MODEL_REJECT_CATEGORIES).map(([key, v]) => ({ key, label: v.label, topic: "model" as LearningTopic })),
  ...Object.entries(GARMENT_REJECT_CATEGORIES).map(([key, v]) => ({ key, label: v.label, topic: "garment" as LearningTopic })),
];

/** Onderwerp van een categorie. Oude learnings (zonder topic) gaan hier doorheen. */
export function topicOf(category: string): LearningTopic {
  return category in GARMENT_REJECT_CATEGORIES ? "garment" : "model";
}

function ruleFor(category: string): string | null {
  const g = GARMENT_REJECT_CATEGORIES[category as GarmentRejectCategory];
  if (g) return g.rule;
  const m = MODEL_REJECT_CATEGORIES[category as ModelRejectCategory];
  return m ? m.rule : null;
}

export type ModelLearning = {
  handle?: string;
  url?: string;
  topic?: LearningTopic;
  category: string;
  reason: string;
  /** De notitie als positieve Engelse instructie — dít gaat de prompt in. */
  directive?: string;
  kind?: "positive" | "negative";
  at: string;
};
export type ModelLearningsStore = { learnings: ModelLearning[]; updatedAt: string | null };
const EMPTY: ModelLearningsStore = { learnings: [], updatedAt: null };

/** Hoeveel beoordelingen er maximaal in de prompt-opbouw meegenomen worden. */
const LEES_LIMIET = 500;

let tabelKlaar = false;

async function zorgVoorTabel(): Promise<void> {
  if (tabelKlaar) return;
  const db = getDb();
  await db.execute(sql`
    create table if not exists model_learnings (
      id bigserial primary key,
      handle text,
      url text,
      topic text not null default 'model',
      category text not null,
      reason text not null default '',
      directive text,
      kind text not null default 'negative',
      at timestamptz not null default now(),
      legacy_key text unique
    )
  `);
  await db.execute(sql`create index if not exists model_learnings_handle_idx on model_learnings (handle)`);
  await db.execute(sql`create index if not exists model_learnings_at_idx on model_learnings (at desc)`);
  tabelKlaar = true;
  await importeerOudeBlob();
}

/**
 * De beoordelingen die vóór de overstap in de blob stonden één keer overzetten.
 * legacy_key is uniek en deterministisch, dus twee instances die dit tegelijk
 * doen leveren geen dubbele regels op — en na de eerste keer is het een no-op.
 * Faalt het (blob weg, token weg), dan gaat het gewoon door: liever de nieuwe
 * feedback wél opslaan dan hierop blijven hangen.
 */
async function importeerOudeBlob(): Promise<void> {
  try {
    const db = getDb();
    const [rij] = (await db.execute<{ n: string }>(sql`select count(*) n from model_learnings`)).rows;
    if (Number(rij?.n || 0) > 0) return;

    const { blobs } = await list({ prefix: PATH, limit: 1, token: blobToken() });
    const b = (blobs || []).find((x) => x.pathname === PATH);
    if (!b) return;
    const res = await fetch(`${b.url}?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as ModelLearningsStore;
    const oud = Array.isArray(data?.learnings) ? data.learnings : [];
    if (!oud.length) return;

    for (const l of oud) {
      const category = String(l.category || "kwaliteit");
      const at = String(l.at || new Date().toISOString());
      await db.execute(sql`
        insert into model_learnings (handle, url, topic, category, reason, directive, kind, at, legacy_key)
        values (${l.handle || null}, ${l.url || null}, ${l.topic || topicOf(category)}, ${category},
                ${String(l.reason || "")}, ${l.directive || null},
                ${l.kind === "positive" ? "positive" : "negative"}, ${at},
                ${`${at}|${l.handle || ""}|${category}|${String(l.reason || "").slice(0, 60)}`})
        on conflict (legacy_key) do nothing
      `);
    }
    console.info(`[model-learnings] ${oud.length} oude beoordelingen uit de blob overgezet naar Neon.`);
  } catch (e) {
    console.warn("[model-learnings] blob-import overgeslagen:", (e as Error).message);
  }
}

export async function getModelLearnings(): Promise<ModelLearningsStore> {
  try {
    await zorgVoorTabel();
    const db = getDb();
    const rows = (await db.execute<{
      handle: string | null; url: string | null; topic: string; category: string;
      reason: string; directive: string | null; kind: string; at: string;
    }>(sql`
      select handle, url, topic, category, reason, directive, kind, at
      from model_learnings order by at desc, id desc limit ${LEES_LIMIET}`)).rows;

    const learnings: ModelLearning[] = rows.map((r) => ({
      handle: r.handle || undefined,
      url: r.url || undefined,
      topic: r.topic === "garment" ? "garment" : "model",
      category: r.category,
      reason: r.reason || "",
      directive: r.directive || undefined,
      kind: r.kind === "positive" ? "positive" : "negative",
      at: new Date(r.at).toISOString(),
    }));
    return { learnings, updatedAt: learnings[0]?.at || null };
  } catch (e) {
    // Neon onbereikbaar → generen mag doorgaan met alleen de basisprompt.
    console.warn("[model-learnings] lezen mislukt:", (e as Error).message);
    return { ...EMPTY };
  }
}

/* De omzetting naar een positieve instructie is gedeeld met de sfeerbeeld-studio
   (lib/feedback-directive.ts); hier doorgegeven zodat bestaande imports werken. */
export { hasDirectiveProvider, toDirective };

export async function addModelLearning(input: {
  handle?: string;
  url?: string;
  topic?: LearningTopic;
  category: string;
  reason: string;
  kind?: "positive" | "negative";
}): Promise<ModelLearningsStore> {
  const category = String(input.category || "kwaliteit");
  const topic: LearningTopic = input.topic === "garment" || input.topic === "model" ? input.topic : topicOf(category);
  const reason = String(input.reason || "").trim().slice(0, 280);
  // Eerst de omzetting (die duurt een seconde), dán pas de database aanraken.
  const directive = (await toDirective(reason, category, topic)) || null;

  await zorgVoorTabel();
  const db = getDb();
  await db.execute(sql`
    insert into model_learnings (handle, url, topic, category, reason, directive, kind)
    values (${input.handle || null}, ${input.url || null}, ${topic}, ${category},
            ${reason}, ${directive}, ${input.kind === "positive" ? "positive" : "negative"})
  `);
  return getModelLearnings();
}

/* ──────────────────────────── prompt-opbouw ──────────────────────────── */

/** Hoeveel er maximaal meegaat — bewust krap, anders verdrinkt de nieuwste feedback. */
const FOCUS_MAX = 6; // correcties voor DEZE foto
const HOUSE_MAX = 3; // generieke categorie-regels over alle foto's heen
const LIKED_MAX = 3; // "zo blijven doen" uit goedkeuringen

const MODEL_BASELINE =
  " The man should look like a real, natural, relatable person with authentic skin texture and subtle natural imperfections — NOT an overly-perfect, glossy, heavily-retouched fashion model.";
const GARMENT_BASELINE =
  " The featured garment must stay identical to the reference product photo — same colour, fabric, pattern, buttons and proportions — and must be worn crisply and neatly.";

/** Placeholder-teksten die geen echte feedback zijn en dus niet de prompt in hoeven. */
const NOISE = new Set(["goedgekeurd model", "goedgekeurd", "top", "ok", "oké", "prima", "goed"]);
const meaningful = (s: string) => s.length > 2 && !NOISE.has(s.toLowerCase());
const uniq = (a: string[]) => [...new Set(a)];

export type ModelPromptBlocks = {
  /** Generieke kleding-regels, hoort achter de zin die het kledingstuk beschrijft. */
  garment: string;
  /** Generieke model-regels + wat het team goed vond. */
  model: string;
  /** Correcties voor precies deze foto — als laatste in de prompt, hoogste prioriteit. */
  fix: string;
  /** Waar de correcties voor deze foto over gaan. Stuurt of we dezelfde man vasthouden. */
  fixTopics: { model: boolean; garment: boolean };
};

/**
 * Bouwt de prompt-blokken voor één modelfoto.
 *
 * Met `handle`: de feedback die bij dít product hoort wordt apart gezet als
 * "must fix" (het laatste wat de generator leest, en het enige wat als
 * correctie-opdracht geformuleerd is). Vrije notities van ándere producten gaan
 * NIET mee — die sloegen nergens op voor deze foto en veroorzaakten de
 * ongevraagde wijzigingen. Wat wél generaliseert zijn de categorie-regels; die
 * gaan mee, gesorteerd op hoe vaak ze gemeld zijn, met een maximum.
 *
 * Zonder `handle` (de bulk-scripts) blijft het bij de baseline + huisregels.
 */
export function modelPromptBlocks(store: ModelLearningsStore, opts: { handle?: string } = {}): ModelPromptBlocks {
  const handle = opts.handle;
  const all = (store.learnings || []).map((l) => ({ ...l, topic: l.topic || topicOf(l.category) }));
  const negatives = all.filter((l) => l.kind !== "positive");
  const text = (l: ModelLearning) => ((l.directive || "").trim() || (l.reason || "").trim());

  const build = (topic: LearningTopic, baseline: string) => {
    const ofTopic = negatives.filter((l) => l.topic === topic);
    const mine = handle ? ofTopic.filter((l) => l.handle === handle) : [];

    // Correcties voor deze foto: per afkeuring één instructie. Is de notitie
    // omgezet naar een positieve instructie, dan die; anders de standaardregel
    // van de gekozen categorie (ook positief geformuleerd). Allebei meesturen
    // levert dubbelop ("mouwen tot de pols" én de mouwlengte-regel).
    //
    // De rúwe notitie is een klácht ("mouwen zijn te lang"). Die mag nooit als
    // opdracht de prompt in — dan genereert het model precies dat. Kon hij niet
    // omgezet worden (geen API-key, time-out), dan gaat hij apart mee, expliciet
    // gelabeld als klacht die gecorrigeerd moet worden.
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

    // Huisregels: de meest gemelde categorieën over álle foto's heen, minus de
    // categorieën die hierboven al als correctie meegaan.
    const counts = new Map<string, number>();
    for (const l of ofTopic) counts.set(l.category, (counts.get(l.category) || 0) + 1);
    const houseRules = [...counts.entries()]
      .filter(([c]) => !mineCats.includes(c))
      .sort((a, b) => b[1] - a[1])
      .slice(0, HOUSE_MAX)
      .map(([c]) => ruleFor(c))
      .filter(Boolean) as string[];

    let block = baseline;
    if (houseRules.length) {
      block += topic === "garment"
        ? ` Garment rules learned from team feedback, strictly follow: ${houseRules.join("; ")}.`
        : ` Model rules learned from team feedback, strictly follow: ${houseRules.join("; ")}.`;
    }
    return { block, fixes: focus, complaints };
  };

  const garment = build("garment", GARMENT_BASELINE);
  const model = build("model", MODEL_BASELINE);

  // Goedkeuringen: kort houden, alleen notities die echt iets zeggen.
  const positives = all.filter((l) => l.kind === "positive");
  const liked = uniq(positives.map(text).filter(meaningful)).slice(0, LIKED_MAX);
  let modelBlock = model.block;
  if (positives.length) {
    modelBlock += ` The team marked ${positives.length} earlier photo(s) as EXCELLENT — match that natural, on-brand look and feel.`;
    if (liked.length) modelBlock += ` Keep doing: ${liked.join("; ")}.`;
  }

  const fixes = [...garment.fixes, ...model.fixes];
  const complaints = [...garment.complaints, ...model.complaints];
  let fix = fixes.length
    ? ` MOST IMPORTANT — our team reviewed the previous version of this exact photo and asked for these corrections. The new photo must show all of them: ${fixes.join("; ")}.`
    : "";
  if (fix && complaints.length) {
    fix += ` For context, their own words on what was wrong last time, written in Dutch — read them as complaints to fix, never as things to render: ${complaints.map((c) => `"${c}"`).join(", ")}.`;
  }

  return {
    garment: garment.block,
    model: modelBlock,
    fix,
    fixTopics: {
      garment: garment.fixes.length > 0 || garment.complaints.length > 0,
      model: model.fixes.length > 0 || model.complaints.length > 0,
    },
  };
}

/**
 * Alles achter elkaar, voor de bulk-scripts die één suffix aan hun prompt plakken.
 * Nieuwe code kan beter modelPromptBlocks gebruiken en de blokken zelf plaatsen.
 */
export function modelLearningsBlock(store: ModelLearningsStore, opts: { handle?: string } = {}): string {
  const b = modelPromptBlocks(store, opts);
  return `${b.garment}${b.model}${b.fix}`;
}
