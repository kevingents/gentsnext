"use client";

import { useEffect, useRef, useState } from "react";
import { useCart } from "@/components/cart/cart-context";
import { useT } from "@/components/i18n/locale-provider";

/** "Tas" — een GENTS-tas-icoon dat kort opveert wanneer er iets bij komt. */
export function CartButton() {
  const cart = useCart();
  const t = useT();
  const [bump, setBump] = useState(false);
  const prev = useRef(cart.count);

  useEffect(() => {
    if (cart.count > prev.current) {
      setBump(true);
      const t = setTimeout(() => setBump(false), 450);
      prev.current = cart.count;
      return () => clearTimeout(t);
    }
    prev.current = cart.count;
  }, [cart.count]);

  return (
    // 44×44px tikvlak; -mx-2 compenseert in de layout (icoon blijft 22px).
    <button
      type="button"
      onClick={cart.open}
      aria-label={t("cart.button.arialabelDynamic", { count: cart.count })}
      className="relative -mx-2 flex h-11 w-11 items-center justify-center text-ink-soft transition-colors hover:text-ink"
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden
        className={bump ? "animate-[popIn_.45s_ease-out]" : ""}
      >
        <path d="M6 8h12l-.8 11.2A2 2 0 0 1 15.2 21H8.8a2 2 0 0 1-2-1.8L6 8Z" strokeLinejoin="round" />
        <path d="M9 8V6.5a3 3 0 0 1 6 0V8" strokeLinecap="round" />
      </svg>
      {cart.count > 0 ? (
        <span
          key={cart.count}
          className="absolute right-0.5 top-1 inline-flex h-[1.05rem] min-w-[1.05rem] animate-[popIn_.35s_ease-out] items-center justify-center rounded-full bg-ink px-1 font-sans text-[0.6rem] font-medium text-canvas"
        >
          {cart.count}
        </span>
      ) : null}
    </button>
  );
}
