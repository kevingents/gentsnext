"use client";

import { useCart } from "@/components/cart/cart-context";

export function CartButton() {
  const cart = useCart();
  return (
    <button
      type="button"
      onClick={cart.open}
      className="relative font-sans text-sm text-ink-soft transition-colors hover:text-ink"
      aria-label={`Winkelwagen, ${cart.count} artikelen`}
    >
      Winkelwagen
      {cart.count > 0 ? (
        <span className="ml-1.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-ink px-1 font-sans text-[0.65rem] text-canvas">
          {cart.count}
        </span>
      ) : null}
    </button>
  );
}
