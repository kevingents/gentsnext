"use client";

import { useWishlist } from "@/components/wishlist/wishlist-context";

type Props = {
  handle: string;
  variant?: "card" | "pdp";
  label?: string;
};

/** Hartje voor producten — geluidloos op de kaart, met label op de PDP. */
export function WishlistButton({ handle, variant = "card", label = "Bewaren" }: Props) {
  const wl = useWishlist();
  const on = wl.hydrated && wl.has(handle);

  if (variant === "pdp") {
    return (
      <button
        type="button"
        onClick={() => wl.toggle(handle)}
        aria-pressed={on}
        className={`inline-flex items-center gap-2 border px-4 py-2 font-sans text-sm transition-colors ${
          on ? "border-ink bg-ink text-canvas" : "border-line hover:border-ink"
        }`}
      >
        <Heart filled={on} />
        {on ? "Bewaard" : label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        wl.toggle(handle);
      }}
      aria-label={on ? "Verwijder uit favorieten" : "Voeg toe aan favorieten"}
      aria-pressed={on}
      className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-canvas/90 text-ink shadow-card transition-colors hover:bg-canvas"
    >
      <Heart filled={on} />
    </button>
  );
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6">
      <path d="M12 21s-7-4.35-9.5-9C1 9.5 2.5 6 6 6c2 0 3.5 1.2 4 2.5C10.5 7.2 12 6 14 6c3.5 0 5 3.5 3.5 6-2.5 4.65-9.5 9-9.5 9z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
