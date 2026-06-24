import { RatingStars } from "@/components/rating-stars";
import { WriteReview } from "@/components/reviews/review-form";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/messages";
import type { Locale } from "@/lib/i18n";
import type { ReviewSummary, PublicReview } from "@/lib/reviews-db";

const dateFmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" });

function fitLabel(fit: string, locale: Locale) {
  return fit === "klein" ? t("reviews.form.fitSmall", locale) : fit === "groot" ? t("reviews.form.fitLarge", locale) : fit === "normaal" ? t("reviews.form.fitNormal", locale) : "";
}

function FitBar({ fit, locale }: { fit: ReviewSummary["fit"]; locale: Locale }) {
  const seg = (n: number) => (fit.total ? Math.round((n / fit.total) * 100) : 0);
  return (
    <div className="mt-5">
      <p className="font-sans text-xs font-medium text-ink">{t("reviews.summary.fitLabel", locale)}</p>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface">
        <span className="block h-full bg-line" style={{ width: `${seg(fit.klein)}%` }} />
        <span className="block h-full bg-ink" style={{ width: `${seg(fit.normaal)}%` }} />
        <span className="block h-full bg-line" style={{ width: `${seg(fit.groot)}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between font-sans text-[0.65rem] text-muted">
        <span>{t("reviews.fitbar.small", locale)}</span>
        <span>{t("reviews.fitbar.normal", locale)}</span>
        <span>{t("reviews.fitbar.large", locale)}</span>
      </div>
    </div>
  );
}

export async function ReviewsSection({
  handle,
  summary,
  reviews,
}: {
  handle: string;
  summary: ReviewSummary | null;
  reviews: PublicReview[];
}) {
  const locale = await getLocale();
  return (
    <section id="reviews" className="mt-20 scroll-mt-24 border-t border-line pt-12">
      <p className="label-brand">Reviews</p>
      <h2 className="mt-2 text-display-md">Wat klanten zeggen</h2>

      <div className="mt-8 grid gap-10 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* Samenvatting */}
        <div className="lg:sticky lg:top-24 lg:h-fit">
          {summary ? (
            <>
              <div className="flex items-end gap-3">
                <span className="font-display text-5xl leading-none">{summary.value.toFixed(1)}</span>
                <div className="pb-1">
                  <RatingStars rating={{ value: summary.value, count: summary.count }} size="md" showCount={false} />
                  <p className="mt-1 font-sans text-xs text-muted">
                    {summary.count} {summary.count === 1 ? "review" : "reviews"}
                  </p>
                </div>
              </div>
              <ul className="mt-4 space-y-1.5">
                {[5, 4, 3, 2, 1].map((star) => {
                  const n = summary.distribution[star - 1];
                  const pct = summary.count ? Math.round((n / summary.count) * 100) : 0;
                  return (
                    <li key={star} className="flex items-center gap-2 font-sans text-xs text-muted">
                      <span className="w-3 text-right">{star}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
                        <span className="block h-full bg-ink" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="w-8 text-right">{n}</span>
                    </li>
                  );
                })}
              </ul>
              {summary.fit.total >= 3 ? <FitBar fit={summary.fit} locale={locale} /> : null}
            </>
          ) : (
            <p className="font-sans text-sm text-ink-soft">
              Er zijn nog geen reviews voor dit artikel. Deel als eerste je ervaring.
            </p>
          )}
          <div className="mt-6">
            <WriteReview handle={handle} />
          </div>
        </div>

        {/* Lijst */}
        <div>
          {reviews.length ? (
            <ul className="divide-y divide-line">
              {reviews.map((r) => (
                <li key={r.id} className="py-5 first:pt-0">
                  <div className="flex items-center justify-between gap-3">
                    <RatingStars rating={{ value: r.rating, count: 0 }} size="sm" showCount={false} />
                    {r.verified ? (
                      <span className="inline-flex items-center gap-1 font-sans text-xs text-success">
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                          <path d="M5 12l5 5 9-9" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {t("reviews.badge.verified", locale)}
                      </span>
                    ) : null}
                  </div>
                  {r.title ? <p className="mt-2 font-sans text-sm font-medium text-ink">{r.title}</p> : null}
                  {r.body ? <p className="mt-1 whitespace-pre-line font-sans text-sm text-ink-soft">{r.body}</p> : null}
                  <p className="mt-2 font-sans text-xs text-muted">
                    {r.authorName} · {dateFmt.format(new Date(r.createdAt))}
                    {fitLabel(r.fit, locale) ? ` · ${fitLabel(r.fit, locale)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-sans text-sm text-muted">Nog geen geschreven reviews — schrijf de eerste.</p>
          )}
        </div>
      </div>
    </section>
  );
}
