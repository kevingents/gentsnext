import { put, list } from "@vercel/blob";

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
 * Opslag = blob (model-learnings/store.json).
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

export async function getModelLearnings(): Promise<ModelLearningsStore> {
  try {
    const { blobs } = await list({ prefix: PATH, limit: 1, token: blobToken() });
    const b = (blobs || []).find((x) => x.pathname === PATH);
    if (!b) return { ...EMPTY };
    const res = await fetch(`${b.url}?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return { ...EMPTY };
    const data = (await res.json()) as ModelLearningsStore;
    return { learnings: Array.isArray(data?.learnings) ? data.learnings : [], updatedAt: data?.updatedAt || null };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * Zet de Nederlandse notitie van een medewerker om in één korte, POSITIEVE
 * Engelse instructie voor de beeldgenerator.
 *
 * Dit is de kern van "mijn feedback doet niks": een beeldmodel volgt geen
 * ontkenningen. "De mouwen zijn te lang" als "avoid long sleeves" de prompt in
 * duwen levert vaak juist lange mouwen op, want het model ziet vooral de woorden
 * "long sleeves". We laten Claude er daarom "sleeves end at the wrist bone,
 * showing a sliver of shirt cuff" van maken. Faalt de omzetting (geen key,
 * time-out, rare output), dan geven we null terug en gebruikt de prompt de ruwe
 * notitie — nooit een harde fout, feedback opslaan mag hier niet op stuklopen.
 */
export async function toDirective(reason: string, category: string, topic: LearningTopic): Promise<string | null> {
  const text = String(reason || "").trim();
  if (text.length < 3) return null;

  const subject = topic === "garment" ? "the garment (fit, length, colour, fabric, details, how it is worn)" : "the male model (face, age, build, pose, hands, styling of the person)";
  const sys =
    `You rewrite Dutch feedback from a menswear photo studio into ONE short English instruction for an AI image generator. ` +
    `The feedback is about ${subject}. Rules: ` +
    `phrase it POSITIVELY as what the new photo MUST show — never use "no", "not", "avoid", "without" or "less", because image models ignore negations and render exactly what you name ` +
    `(example: "het jasje is te lang" becomes "jacket length ends just below the seat, classic menswear proportions"); ` +
    `stay concrete and visual; max 20 words; no quotes, no explanation, no trailing period. Return ONLY the instruction.`;
  const user = `Categorie: ${category}\nNotitie: ${text}`;

  const anth = process.env.ANTHROPIC_API_KEY;
  const oai = process.env.OPENAI_API_KEY;
  try {
    let out = "";
    if (anth) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": anth, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.CONTENT_MODEL || process.env.SUPPORT_MODEL || "claude-haiku-4-5-20251001",
          max_tokens: 120,
          temperature: 0,
          system: sys,
          messages: [{ role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) return null;
      out = (await r.json())?.content?.[0]?.text || "";
    } else if (oai) {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${oai}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          temperature: 0,
          messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) return null;
      out = (await r.json())?.choices?.[0]?.message?.content || "";
    } else {
      return null;
    }
    const one = out.trim().split("\n")[0].replace(/^["']|["'.]+$/g, "").trim();
    return one.length > 2 ? one.slice(0, 200) : null;
  } catch {
    return null;
  }
}

export async function addModelLearning(input: {
  handle?: string;
  url?: string;
  topic?: LearningTopic;
  category: string;
  reason: string;
  kind?: "positive" | "negative";
}): Promise<ModelLearningsStore> {
  const store = await getModelLearnings();
  const category = String(input.category || "kwaliteit");
  const topic: LearningTopic = input.topic === "garment" || input.topic === "model" ? input.topic : topicOf(category);
  const reason = String(input.reason || "").trim().slice(0, 280);
  const directive = (await toDirective(reason, category, topic)) || undefined;
  const entry: ModelLearning = {
    handle: input.handle,
    url: input.url,
    topic,
    category,
    reason,
    directive,
    kind: input.kind === "positive" ? "positive" : "negative",
    at: new Date().toISOString(),
  };
  const next: ModelLearningsStore = {
    learnings: [entry, ...store.learnings].slice(0, 500),
    updatedAt: new Date().toISOString(),
  };
  await put(PATH, JSON.stringify(next, null, 2), {
    access: "public",
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0,
    token: blobToken(),
  });
  return next;
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

  return { garment: garment.block, model: modelBlock, fix };
}

/**
 * Alles achter elkaar, voor de bulk-scripts die één suffix aan hun prompt plakken.
 * Nieuwe code kan beter modelPromptBlocks gebruiken en de blokken zelf plaatsen.
 */
export function modelLearningsBlock(store: ModelLearningsStore, opts: { handle?: string } = {}): string {
  const b = modelPromptBlocks(store, opts);
  return `${b.garment}${b.model}${b.fix}`;
}
