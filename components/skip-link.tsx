/** Visueel verborgen skip-link; verschijnt op focus. WCAG 2.1 AA / EAA-eis. */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only fixed left-2 top-2 z-[100] bg-ink px-3 py-2 font-sans text-sm text-canvas focus:not-sr-only"
    >
      Direct naar inhoud
    </a>
  );
}
