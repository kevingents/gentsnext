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
    <main className="mx-auto max-w-lg px-4 py-12">
      <h1 className="text-2xl font-semibold text-neutral-900">{t("profielAfronden.title")}</h1>
      <p className="mt-2 text-sm text-neutral-600">{t("profielAfronden.intro.part1")} <strong>{t("profielAfronden.intro.points")}</strong> {t("profielAfronden.intro.part2")}</p>
      {token
        ? <ProfileCompletionForm token={token} email={email} />
        : <p className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{t("profielAfronden.invalidLink")}</p>}
    </main>
  );
}
