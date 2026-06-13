import type { ProductRating } from "@/lib/reviews";

/** Sterretjes-rij + optionele telling. Pure SVG, geen scripts. */
export function RatingStars({ rating, size = "sm" }: { rating: ProductRating | null; size?: "xs" | "sm" | "md" }) {
  if (!rating) return null;
  const px = size === "xs" ? 10 : size === "sm" ? 14 : 18;
  const filled = Math.round(rating.value * 2) / 2; // halve sterren
  return (
    <span className="inline-flex items-center gap-1 font-sans text-xs text-ink-soft">
      <span className="inline-flex" aria-label={`Beoordeling ${rating.value.toFixed(1)} uit 5, ${rating.count} reviews`}>
        {[0, 1, 2, 3, 4].map((i) => {
          const fill = Math.max(0, Math.min(1, filled - i));
          return (
            <svg key={i} width={px} height={px} viewBox="0 0 24 24" aria-hidden>
              <defs>
                <linearGradient id={`s${i}-${px}`}>
                  <stop offset={`${fill * 100}%`} stopColor="currentColor" />
                  <stop offset={`${fill * 100}%`} stopColor="transparent" />
                </linearGradient>
              </defs>
              <path
                d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27z"
                fill={`url(#s${i}-${px})`}
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          );
        })}
      </span>
      <span className="text-muted">({rating.count})</span>
    </span>
  );
}
