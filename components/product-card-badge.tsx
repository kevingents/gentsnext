/** Klein label boven aan de productkaart — Nieuw / Sale / Bestseller. */
export function ProductCardBadge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "sale" | "new" }) {
  const cls =
    tone === "sale"
      ? "bg-danger text-canvas"
      : tone === "new"
        ? "bg-ink text-canvas"
        : "bg-canvas text-ink border border-ink/15";
  return (
    // max-w + truncate: een lange badge ("Laatste exemplaren") liep op smalle
    // kaarten onder het wishlist-hartje door.
    <span className={`absolute left-2 top-2 z-10 inline-flex max-w-[calc(100%-3.5rem)] items-center truncate px-2 py-0.5 font-sans text-[0.6rem] uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}
