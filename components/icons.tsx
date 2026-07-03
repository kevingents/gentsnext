/**
 * Gedeelde mini-iconen — SVG i.p.v. tekst-glyphs (huisregel: nooit ●/✓/✕ als
 * UI-element). Bewust ZONDER "use client": ook bruikbaar in server components
 * (zoekpagina, winkelwagen). Kleur via currentColor → de bestaande
 * text-success/text-danger-spans blijven gewoon werken.
 */

export function Dot({ className = "h-2 w-2" }: { className?: string }) {
  return (
    <svg viewBox="0 0 8 8" className={className} aria-hidden="true" focusable="false">
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  );
}

export function CheckIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" focusable="false">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function CrossIcon({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden="true" focusable="false">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
