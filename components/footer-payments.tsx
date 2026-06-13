/** Smalle betaalmethoden-strip onderaan de footer. Tekstueel, in huisstijl. */
const METHODS = ["iDEAL", "Mastercard", "Visa", "Apple Pay", "Klarna", "PayPal"];

export function FooterPayments() {
  return (
    <div className="mx-auto flex max-w-page flex-wrap items-center justify-center gap-x-4 gap-y-2 px-gutter py-3 text-canvas/60">
      {METHODS.map((m) => (
        <span key={m} className="border border-canvas/15 px-3 py-1 font-sans text-[0.7rem] uppercase tracking-wider">
          {m}
        </span>
      ))}
    </div>
  );
}
