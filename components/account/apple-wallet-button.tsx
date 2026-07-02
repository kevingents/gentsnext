"use client";

/**
 * "Voeg toe aan Apple Wallet"-knop. Linkt naar /api/wallet/apple, dat een
 * ondertekende .pkpass teruggeeft; iPhone/Safari opent 'm direct in Wallet.
 * (Voor volledige Apple-merkrichtlijnen kan hier later de officiële localized
 * "Add to Apple Wallet"-badge in — deze knop is de functionele variant.)
 */
export function AppleWalletButton({ className = "" }: { className?: string }) {
  return (
    <a
      href="/api/wallet/apple"
      className={`inline-flex items-center gap-2.5 rounded-xl bg-ink px-5 py-3 font-sans text-sm text-canvas transition-opacity hover:opacity-90 ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
        <path d="M16.365 1.43c0 1.14-.417 2.2-1.11 2.98-.83.94-2.18 1.66-3.29 1.57-.14-1.1.43-2.27 1.08-3 .74-.83 2.02-1.45 3.1-1.5.03.18.02.36.02.55.13-.19.13-.4.1-.6zM20.5 17.14c-.55 1.27-.82 1.84-1.53 2.96-.99 1.57-2.39 3.52-4.12 3.54-1.54.01-1.93-1-4.02-.99-2.09.01-2.52 1-4.06.99-1.73-.02-3.06-1.78-4.05-3.34C.15 16.98-.14 12.4 1.55 9.95c.98-1.42 2.53-2.32 3.99-2.32 1.49 0 2.42.99 3.65.99 1.19 0 1.92-.99 3.64-.99 1.31 0 2.7.71 3.69 1.94-3.24 1.78-2.71 6.4.98 7.57z" />
      </svg>
      Voeg toe aan Apple&nbsp;Wallet
    </a>
  );
}
