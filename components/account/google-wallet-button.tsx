"use client";

/**
 * "Toevoegen aan Google Wallet"-knop (Android-tegenhanger van de Apple-knop).
 * Linkt naar /api/wallet/google, dat doorstuurt naar pay.google.com met een
 * ondertekende save-link. Zelfde vorm en maat als de Apple-knop, zodat ze naast
 * elkaar geen rommel worden.
 *
 * SVG-logo, geen emoji (huisregel). Voor volledige Google-merkrichtlijnen kan
 * hier later de officiële "Add to Google Wallet"-badge in; dit is de
 * functionele variant in onze eigen huisstijl.
 */
export function GoogleWalletButton({ className = "" }: { className?: string }) {
  return (
    <a
      href="/api/wallet/google"
      className={`inline-flex items-center gap-2.5 rounded-xl bg-ink px-5 py-3 font-sans text-sm text-canvas transition-opacity hover:opacity-90 ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="6" width="20" height="13" rx="2.5" />
        <path d="M2 10.5h20" />
        <path d="M16.5 15.5h2" />
      </svg>
      Toevoegen aan Google&nbsp;Wallet
    </a>
  );
}
