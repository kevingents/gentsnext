/** Klein label boven aan de productkaart — Nieuw / Sale / Bestseller. */
export function ProductCardBadge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "sale" | "new" }) {
  const cls =
    tone === "sale"
      ? "bg-danger text-canvas"
      : tone === "new"
        ? "bg-ink text-canvas"
        : "bg-canvas text-ink border border-ink/15";
  return (
    <span className={`absolute left-2 top-2 z-10 inline-flex items-center px-2 py-0.5 font-sans text-[0.6rem] uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}
