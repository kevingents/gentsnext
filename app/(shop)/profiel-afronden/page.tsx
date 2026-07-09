import type { Metadata } from "next";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";
import { ProfileCompletionForm } from "./ProfileCompletionForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Profiel afronden — GENTS",
  robots: { index: false, follow: false },
};

/**
 * /profiel-afronden?token=…&email=… — landingspagina van de "+50 punten"-mail.
 * De klant maakt z'n profiel compleet; het token autoriseert de bonus (éénmalig).
 */
export default async function ProfielAfrondenPage({ searchParams }: { searchParams: Promise<{ token?: string; email?: string }> }) {
  const sp = await searchParams;
  const locale = await getLocale();
  const t = await getT(locale);
  const token = String(sp.token || "").trim();
  const email = String(sp.email || "").trim();

  return (
    // Huisstijl (ink/line + display-kop) i.p.v. generiek neutral/amber-Tailwind —
    // deze klant-landingspagina moet als GENTS aanvoelen.
    <main className="mx-auto max-w-lg px-gutter py-12">
      <p className="label-brand">{t("login.eyebrow")}</p>
      <h1 className="mt-2 font-display text-2xl font-light text-ink">{t("profielAfronden.title")}</h1>
      <p className="mt-2 font-sans text-sm text-ink-soft">{t("profielAfronden.intro.part1")} <strong className="text-ink">{t("profielAfronden.intro.points")}</strong> {t("profielAfronden.intro.part2")}</p>
      {token
        ? <ProfileCompletionForm token={token} email={email} />
        : <p className="mt-8 rounded-card border border-line bg-surface p-4 font-sans text-sm text-ink-soft">{t("profielAfronden.invalidLink")}</p>}
    </main>
  );
}
