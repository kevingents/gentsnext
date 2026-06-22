import { put, list } from "@vercel/blob";

/**
 * Lerende modellen-AI: aparte "learnings-store" voor de MODELLEN (de persoon op
 * de modelfoto), los van de sfeerbeeld-learnings. Medewerkers keuren modellen
 * goed/af met een reden/categorie; die feedback wordt hier bewaard en in élke
 * volgende modelfoto-prompt geïnjecteerd → de AI leert onze model-smaak.
 * Opslag = blob (model-learnings/store.json).
 */
const PATH = "model-learnings/store.json";

function blobToken(): string {
  return process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
}

/** Afkeur-categorieën voor modellen: NL-label (UI) + EN-regel (prompt-injectie). */
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

export type ModelRejectCategory = keyof typeof MODEL_REJECT_CATEGORIES;

export type ModelLearning = {
  handle?: string;
  url?: string;
  category: string;
  reason: string;
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

export async function addModelLearning(input: { handle?: string; url?: string; category: string; reason: string; kind?: "positive" | "negative" }): Promise<ModelLearningsStore> {
  const store = await getModelLearnings();
  const entry: ModelLearning = {
    handle: input.handle,
    url: input.url,
    category: String(input.category || "kwaliteit"),
    reason: String(input.reason || "").trim().slice(0, 280),
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

/**
 * Bouwt het prompt-blok dat in élke modelfoto-prompt gaat. Bevat ALTIJD een
 * baseline (echte, natuurlijke man — niet te perfect, want dat is de kern-
 * feedback) plus de geleerde regels/redenen uit goed-/afkeuringen.
 */
export function modelLearningsBlock(store: ModelLearningsStore): string {
  const negatives = store.learnings.filter((l) => l.kind !== "positive");
  const positives = store.learnings.filter((l) => l.kind === "positive");

  let block = " The man should look like a real, natural, relatable person with authentic skin texture and subtle natural imperfections — NOT an overly-perfect, glossy, heavily-retouched fashion model.";

  const cats = [...new Set(negatives.map((l) => l.category))];
  const rules = cats.map((c) => MODEL_REJECT_CATEGORIES[c as ModelRejectCategory]?.rule).filter(Boolean);
  const avoid = [...new Set(negatives.map((l) => l.reason).filter((r) => r && r.length > 2))].slice(0, 15);
  const liked = [...new Set(positives.map((l) => l.reason).filter((r) => r && r.length > 2))].slice(0, 15);

  if (rules.length) block += ` Model rules learned from team feedback, STRICTLY follow: ${rules.join("; ")}.`;
  if (avoid.length) block += ` Specifically avoid: ${avoid.join("; ")}.`;
  if (positives.length) {
    block += ` The team marked ${positives.length} earlier model(s) as EXCELLENT — match that natural, on-brand look and feel.`;
    if (liked.length) block += ` Keep doing: ${liked.join("; ")}.`;
  }
  return block;
}
