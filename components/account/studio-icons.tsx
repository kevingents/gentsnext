/**
 * Kleine inline SVG-iconen voor de Site-studio-formulieren (geen emoji).
 * Bewust zonder eigen kleur/omvang-aannames: erven currentColor en 1em-maat
 * via de meegegeven className.
 */
function Icon({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const IconUp = (p: { className?: string }) => <Icon d="M12 19V5M5 12l7-7 7 7" {...p} />;
export const IconDown = (p: { className?: string }) => <Icon d="M12 5v14M19 12l-7 7-7-7" {...p} />;
export const IconTrash = (p: { className?: string }) => <Icon d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" {...p} />;
export const IconPlus = (p: { className?: string }) => <Icon d="M12 5v14M5 12h14" {...p} />;
export const IconChevron = (p: { className?: string }) => <Icon d="M6 9l6 6 6-6" {...p} />;
