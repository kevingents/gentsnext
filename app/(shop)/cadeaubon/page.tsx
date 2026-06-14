import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { getSessionCustomer } from "@/lib/account";
import { GiftcardBuyForm } from "@/components/giftcard/giftcard-buy-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cadeaubon",
  description: "Geef GENTS cadeau. Een digitale cadeaubon, direct per e-mail bij de ontvanger — te besteden op alles in de collectie.",
};

const USPS = [
  "Direct per e-mail bij de ontvanger",
  "Te besteden op de hele collectie, online en in de winkel",
  "In meerdere keren te gebruiken tot het saldo op is",
  "Geen verzendkosten — een cadeaubon is altijd raak",
];

export default async function CadeaubonPage({ searchParams }: { searchParams: Promise<{ geannuleerd?: string }> }) {
  const { geannuleerd } = await searchParams;
  const [{ giftcardConfig: cfg }, customer] = await Promise.all([getSettings(), getSessionCustomer()]);

  if (!cfg.enabled) {
    return (
      <div className="mx-auto max-w-page px-gutter py-20 text-center">
        <h1 className="text-display-md">Cadeaubonnen</h1>
        <p className="mt-3 font-sans text-ink-soft">Cadeaubonnen zijn op dit moment niet beschikbaar. Kom snel terug.</p>
        <Link href="/" className="btn-ghost mt-8 inline-flex">Terug naar home</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <p className="label-brand">Cadeaubon</p>
      <h1 className="mt-2 text-display-md">Geef GENTS cadeau</h1>

      {geannuleerd ? (
        <div className="mt-6 rounded-card border border-line bg-surface px-4 py-3 font-sans text-sm text-ink-soft">
          <span className="font-medium text-ink">Je betaling is geannuleerd.</span> Er is niets afgeschreven — je kunt het zo opnieuw proberen.
        </div>
      ) : null}

      <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="max-w-prose font-sans text-ink-soft">
            Twijfel je over de maat of de smaak? Met een GENTS-cadeaubon zit je altijd goed. De ontvanger kiest zelf — een pak, een overhemd, schoenen of een compleet nieuwe look.
          </p>
          <ul className="mt-6 space-y-2.5">
            {USPS.map((u) => (
              <li key={u} className="flex items-start gap-2.5 font-sans text-sm text-ink-soft">
                <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M5 12l5 5 9-9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {u}
              </li>
            ))}
          </ul>
          <p className="mt-8 font-sans text-xs text-muted">
            Een cadeaubon verzilveren? Vul de code in bij het afrekenen onder “Cadeaubon”.
          </p>
        </div>

        <GiftcardBuyForm
          presetCents={cfg.presetAmountsCents}
          minCents={cfg.minCents}
          maxCents={cfg.maxCents}
          validityMonths={cfg.validityMonths}
          defaultBuyerEmail={customer?.email ?? ""}
        />
      </div>
    </div>
  );
}
