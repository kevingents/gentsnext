import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { getPublishedReviews, type PublicReview } from "@/lib/reviews-db";

/**
 * AI-reviewsamenvatting per product. Claude leest de gepubliceerde reviews en
 * destilleert een korte blurb + pluspunten/aandachtspunten + pasvorm-notitie.
 *
 * PORTAL-GESTUURD: het genereren (Claude-call) gebeurt expliciet vanuit de
 * portal (of een batch-actie), NIET bij elk PDP-bezoek. De PDP leest enkel de
 * cache (snel, gratis). Cache = app_settings-rij `reviewai:<handle>`.
 */

export type ReviewAiSummary = {
  blurb: string;
  pros: string[];
  cons: string[];
  fitNote?: string;
  basedOn: number; // aantal reviews waarop gebaseerd
  generatedAt: string;
};

const MIN_REVIEWS = 4;
const keyFor = (handle: string) => `reviewai:${handle}`;

/** Snelle, gratis read voor de PDP — alleen de cache, geen AI-call. */
export async function getCachedReviewAiSummary(handle: string): Promise<ReviewAiSummary | null> {
  if (!handle) return null;
  try {
    const db = getDb();
    const rows = await db.select().from(appSettings).where(eq(appSettings.id, keyFor(handle))).limit(1);
    const data = rows[0]?.data as ReviewAiSummary | undefined;
    return data && Array.isArray(data.pros) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Bouwt (en cachet) de samenvatting via Claude. Slaat over als de cache al op
 * het huidige aantal reviews is gebaseerd (tenzij force). Geeft null bij te
 * weinig reviews of als er geen ANTHROPIC_API_KEY is.
 */
export async function buildAndCacheReviewAiSummary(
  handle: string,
  opts: { force?: boolean } = {},
): Promise<ReviewAiSummary | null> {
  if (!handle) return null;
  const reviews = await getPublishedReviews(handle, 40);
  if (reviews.length < MIN_REVIEWS) return null;

  const db = getDb();
  if (!opts.force) {
    const cached = await getCachedReviewAiSummary(handle);
    if (cached && cached.basedOn === reviews.length) return cached;
  }

  const built = await summarizeWithClaude(reviews);
  if (!built) return await getCachedReviewAiSummary(handle); // val terug op bestaande cache

  const summary: ReviewAiSummary = {
    blurb: built.blurb,
    pros: built.pros.slice(0, 4),
    cons: built.cons.slice(0, 3),
    fitNote: built.fitNote || undefined,
    basedOn: reviews.length,
    generatedAt: new Date().toISOString(),
  };

  try {
    await db
      .insert(appSettings)
      .values({ id: keyFor(handle), data: summary, updatedAt: sql`now()` })
      .onConflictDoUpdate({ target: appSettings.id, set: { data: summary, updatedAt: sql`now()` } });
  } catch {
    /* cache-schrijven mag niet breken */
  }
  return summary;
}

type Built = { blurb: string; pros: string[]; cons: string[]; fitNote?: string };

async function summarizeWithClaude(reviews: PublicReview[]): Promise<Built | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const fitCount = { klein: 0, normaal: 0, groot: 0 };
  for (const r of reviews) if (r.fit && fitCount[r.fit as keyof typeof fitCount] !== undefined) fitCount[r.fit as keyof typeof fitCount]++;

  const sample = reviews
    .slice(0, 30)
    .map((r) => `(${r.rating}/5${r.fit ? `, pasvorm: ${r.fit}` : ""}) ${r.title ? r.title + " — " : ""}${r.body}`.trim())
    .filter((s) => s.length > 4)
    .join("\n");

  const system = `Je vat productreviews samen voor een premium herenmode-webshop (GENTS). Schrijf NEUTRAAL en EERLIJK in het Nederlands, UITSLUITEND op basis van de meegegeven reviews — verzin niets en overdrijf niet. Noem ook aandachtspunten als die er zijn. Antwoord ALLEEN met JSON:
{"blurb":"1-2 zinnen kernsamenvatting","pros":["kort pluspunt", "..."],"cons":["kort aandachtspunt", "..."],"fitNote":"korte pasvorm-notitie of leeg"}
Maximaal 4 pros en 3 cons, elk kort (max ~6 woorden). Als er geen echte aandachtspunten zijn, geef een lege cons-lijst. Gebruik de pasvorm-tellingen voor fitNote (bv. 'Valt vaak kleiner uit') alleen als het signaal duidelijk is.`;

  const userMsg = `Pasvorm-tellingen: klein=${fitCount.klein}, normaal=${fitCount.normaal}, groot=${fitCount.groot}.\n\nReviews:\n${sample}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.SUPPORT_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const text = j?.content?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    if (typeof parsed.blurb !== "string") return null;
    return {
      blurb: String(parsed.blurb).slice(0, 300),
      pros: Array.isArray(parsed.pros) ? parsed.pros.map((x: unknown) => String(x).slice(0, 60)).filter(Boolean) : [],
      cons: Array.isArray(parsed.cons) ? parsed.cons.map((x: unknown) => String(x).slice(0, 60)).filter(Boolean) : [],
      fitNote: parsed.fitNote ? String(parsed.fitNote).slice(0, 80) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Batch-bouw voor alle producten met genoeg gepubliceerde reviews (portal-actie).
 * Bouwt alleen wat verouderd is (ander aantal reviews) tenzij force. Geeft een
 * telling terug. Begrensd om credits/looptijd te beheersen.
 */
export async function buildAllReviewSummaries(opts: { force?: boolean; max?: number } = {}): Promise<{ built: number; skipped: number; eligible: number }> {
  const db = getDb();
  const max = Math.max(1, Math.min(500, opts.max ?? 200));
  const rows = await db.execute<{ handle: string; n: number }>(sql`
    select product_handle as handle, count(*)::int n
    from reviews where status = 'published'
    group by product_handle having count(*) >= ${MIN_REVIEWS}
    order by n desc limit ${max}
  `);
  let built = 0;
  let skipped = 0;
  for (const r of rows.rows) {
    const before = opts.force ? null : await getCachedReviewAiSummary(r.handle);
    if (before && before.basedOn === Number(r.n)) {
      skipped++;
      continue;
    }
    const res = await buildAndCacheReviewAiSummary(r.handle, { force: opts.force });
    if (res) built++;
    else skipped++;
  }
  return { built, skipped, eligible: rows.rows.length };
}
