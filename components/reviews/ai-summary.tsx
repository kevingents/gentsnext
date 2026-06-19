import type { ReviewAiSummary } from "@/lib/review-summary";

/**
 * AI-samenvatting van de reviews op de PDP (leest enkel de cache). Toont een
 * eerlijke blurb + pluspunten/aandachtspunten + pasvorm-notitie. Huisregel:
 * SVG-iconen, geen emoji's.
 */
export function AiReviewSummary({ summary }: { summary: ReviewAiSummary | null }) {
  if (!summary || !summary.blurb) return null;
  return (
    <section className="mt-16 rounded-card border border-line bg-surface/60 p-5 sm:p-6">
      <p className="label-brand">Samenvatting van reviews</p>
      <p className="mt-2 max-w-prose font-sans text-sm leading-relaxed text-ink">{summary.blurb}</p>

      {(summary.pros.length > 0 || summary.cons.length > 0) && (
        <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {summary.pros.length > 0 && (
            <ul className="space-y-1.5">
              {summary.pros.map((p, i) => (
                <li key={i} className="flex items-start gap-2 font-sans text-sm text-ink-soft">
                  <PlusIcon />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
          {summary.cons.length > 0 && (
            <ul className="space-y-1.5">
              {summary.cons.map((c, i) => (
                <li key={i} className="flex items-start gap-2 font-sans text-sm text-ink-soft">
                  <MinusIcon />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {summary.fitNote ? <p className="mt-4 font-sans text-xs text-muted">Pasvorm: {summary.fitNote}</p> : null}
      <p className="mt-2 font-sans text-[11px] text-muted">Automatisch samengevat uit {summary.basedOn} reviews.</p>
    </section>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-success" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M3.5 8h9" />
    </svg>
  );
}
