import type { ViewStats } from "@/lib/social-proof";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/messages";

/**
 * Subtiele, EERLIJKE social-proof bij de buy-box. Toont alleen iets bij een
 * betekenisvol echt signaal (geen verzonnen "x kijken nu"). Het pulserende
 * stipje is enkel een sfeer-cue, geen claim over real-time aanwezigheid.
 */
export async function SocialProof({ stats }: { stats: ViewStats }) {
  const locale = await getLocale();
  let text = "";
  if (stats.viewers24h >= 5) text = t("pdp.socialProof.viewers24h", locale, { count: stats.viewers24h });
  else if (stats.views7d >= 15) text = t("pdp.socialProof.views7d", locale, { count: stats.views7d });
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
