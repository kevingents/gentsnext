import type { ViewStats } from "@/lib/social-proof";

/**
 * Subtiele, EERLIJKE social-proof bij de buy-box. Toont alleen iets bij een
 * betekenisvol echt signaal (geen verzonnen "x kijken nu"). Het pulserende
 * stipje is enkel een sfeer-cue, geen claim over real-time aanwezigheid.
 */
export function SocialProof({ stats }: { stats: ViewStats }) {
  let text = "";
  if (stats.viewers24h >= 5) text = `${stats.viewers24h} mensen bekeken dit de afgelopen 24 uur`;
  else if (stats.views7d >= 15) text = `Populair · ${stats.views7d}× bekeken deze week`;
  if (!text) return null;

  return (
    <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 font-sans text-xs text-ink-soft">
      <span aria-hidden className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      {text}
    </p>
  );
}
