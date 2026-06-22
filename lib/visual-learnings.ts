import { put, list } from "@vercel/blob";

/**
 * Lerende sfeerbeeld-AI: de "learnings-store". Medewerkers keuren slechte
 * sfeerbeelden af met een reden/categorie; die feedback wordt hier bewaard en in
 * élke volgende sfeerbeeld-prompt geïnjecteerd (negatieven/voorkeuren) — zo leert
 * de AI onze stijl. Opslag = blob (visual-learnings/store.json).
 */

const PATH = "visual-learnings/store.json";

function blobToken(): string {
  return process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
}

/** Afkeur-categorieën: NL-label (UI) + EN-regel (prompt-injectie). */
export const REJECT_CATEGORIES = {
  achtergrond: { label: "Achtergrond te druk/rommelig", rule: "the background must be simple, clean and uncluttered — never busy, cluttered or distracting" },
  sfeer: { label: "Verkeerde sfeer/uitstraling", rule: "the mood must be premium, calm and editorial, true to the GENTS menswear brand" },
  model: { label: "Model/persoon klopt niet", rule: "show an ordinary, natural, real man with authentic real skin — never a glossy, flawless fashion model" },
  kleur: { label: "Kleur klopt niet", rule: "keep the product colour exactly true to the reference product" },
  product: { label: "Product is veranderd", rule: "keep the shown product perfectly accurate to the reference photo — do not alter, redesign or restyle it" },
  houding: { label: "Houding/compositie fout", rule: "a natural, relaxed, candid pose and a well-balanced composition" },
  belichting: { label: "Belichting fout", rule: "soft, natural, on-brand lighting — never harsh, flat or artificial" },
  kwaliteit: { label: "Algemene kwaliteit", rule: "sharp, high-quality, realistic editorial photography without artefacts" },
} as const;

export type RejectCategory = keyof typeof REJECT_CATEGORIES;

export type Learning = {
  handle?: string;
  slot?: number;
  url?: string;
  category: string;
  reason: string;
  /** 'negative' = afgekeurd (vermijden), 'positive' = top/geweldig (zo houden). */
  kind?: "positive" | "negative";
  at: string;
};

export type LearningsStore = { learnings: Learning[]; updatedAt: string | null };

const EMPTY: LearningsStore = { learnings: [], updatedAt: null };

/** Lees de learnings-store (cache-bust zodat verse afkeuringen direct meetellen). */
export async function getVisualLearnings(): Promise<LearningsStore> {
  try {
    const { blobs } = await list({ prefix: PATH, limit: 1, token: blobToken() });
    const b = (blobs || []).find((x) => x.pathname === PATH);
    if (!b) return { ...EMPTY };
    const res = await fetch(`${b.url}?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return { ...EMPTY };
    const data = (await res.json()) as LearningsStore;
    return { learnings: Array.isArray(data?.learnings) ? data.learnings : [], updatedAt: data?.updatedAt || null };
  } catch {
    return { ...EMPTY };
  }
}

/** Voeg een afkeuring/learning toe (nieuwste eerst, gecapt op 500). */
export async function addLearning(input: { handle?: string; slot?: number; url?: string; category: string; reason: string; kind?: "positive" | "negative" }): Promise<LearningsStore> {
  const store = await getVisualLearnings();
  const entry: Learning = {
    handle: input.handle,
    slot: input.slot,
    url: input.url,
    category: String(input.category || "kwaliteit"),
    reason: String(input.reason || "").trim().slice(0, 280),
    kind: input.kind === "positive" ? "positive" : "negative",
    at: new Date().toISOString(),
  };
  const next: LearningsStore = {
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
 * Bouwt het prompt-blok dat in élke nieuwe sfeerbeeld-prompt gaat: de EN-regels
 * van alle getriggerde categorieën + de meest recente vrije redenen. Zo "leert"
 * de generatie van wat eerder is afgekeurd.
 */
export function learningsPromptBlock(store: LearningsStore): string {
  if (!store.learnings.length) return "";
  const negatives = store.learnings.filter((l) => l.kind !== "positive");
  const positives = store.learnings.filter((l) => l.kind === "positive");

  const cats = [...new Set(negatives.map((l) => l.category))];
  const rules = cats
    .map((c) => REJECT_CATEGORIES[c as RejectCategory]?.rule)
    .filter(Boolean);
  const avoid = [...new Set(negatives.map((l) => l.reason).filter((r) => r && r.length > 2))].slice(0, 15);
  const liked = [...new Set(positives.map((l) => l.reason).filter((r) => r && r.length > 2))].slice(0, 15);

  let block = "";
  if (rules.length) block += ` IMPORTANT — style rules learned from team feedback, STRICTLY follow: ${rules.join("; ")}.`;
  if (avoid.length) block += ` Also specifically avoid these noted problems: ${avoid.join("; ")}.`;
  if (positives.length) {
    block += ` The team marked ${positives.length} earlier image(s) as EXCELLENT — match that premium, on-brand editorial quality and feel.`;
    if (liked.length) block += ` Specifically keep doing: ${liked.join("; ")}.`;
  }
  return block;
}
