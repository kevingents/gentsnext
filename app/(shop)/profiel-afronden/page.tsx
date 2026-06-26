import type { Metadata } from "next";
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
  const token = String(sp.token || "").trim();
  const email = String(sp.email || "").trim();

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <h1 className="text-2xl font-semibold text-neutral-900">Rond je profiel af</h1>
      <p className="mt-2 text-sm text-neutral-600">Maak je GENTS-profiel compleet (naam + maten) en we zetten <strong>50 spaarpunten</strong> op je voucherkaart. Zo krijg je voortaan advies dat echt bij je past.</p>
      {token
        ? <ProfileCompletionForm token={token} email={email} />
        : <p className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Deze link is niet geldig of verlopen. Vraag in de winkel om een nieuwe.</p>}
    </main>
  );
}
