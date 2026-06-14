/**
 * Branded "state"-pagina (lege winkelwagen, bedankt, foutmeldingen, …) in de
 * GENTS-huisstijl: groot G-watermerk, gouden eyebrow, editorial kop. Houdt de
 * kale utility-pagina's op merk.
 */
export function BrandedState({
  eyebrow,
  title,
  intro,
  children,
  watermark = "G",
}: {
  eyebrow: string;
  title: React.ReactNode;
  intro?: React.ReactNode;
  children?: React.ReactNode;
  watermark?: string;
}) {
  return (
    <div className="relative mx-auto max-w-xl overflow-hidden px-gutter py-20 text-center sm:py-24">
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-6 -z-10 -translate-x-1/2 select-none font-display leading-none text-ink/[0.04]"
        style={{ fontSize: "15rem" }}
      >
        {watermark}
      </span>
      <p className="font-sans text-xs uppercase tracking-[0.35em] text-gold">{eyebrow}</p>
      <h1 className="mt-3 text-display-md">{title}</h1>
      {intro ? <p className="mx-auto mt-4 max-w-prose font-sans text-ink-soft">{intro}</p> : null}
      {children ? <div className="mt-8">{children}</div> : null}
    </div>
  );
}
