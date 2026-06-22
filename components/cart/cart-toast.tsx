"use client";

import { useEffect } from "react";
import { useCart } from "@/components/cart/cart-context";

/**
 * Subtiele "toegevoegd aan winkelwagen"-toast — gebruikt bij toevoegen vanuit een
 * look (cart.add(line, { quiet: true })), i.p.v. de grote bevestig-modal. Onderaan,
 * verdwijnt vanzelf; klik opent de winkelwagen.
 */
export function CartToast() {
  const cart = useCart();
  const toast = cart.toast;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => cart.dismissToast(), 2800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.nonce]);

  if (!toast) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[70] flex justify-center px-4" role="status" aria-live="polite">
      <button
        type="button"
        onClick={() => { cart.dismissToast(); cart.open(); }}
        className="pointer-events-auto flex items-center gap-2.5 rounded-full bg-ink px-5 py-3 font-sans text-sm text-canvas shadow-drawer"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-success" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="font-medium">{toast.title}</span>
        <span className="text-canvas/70">toegevoegd</span>
        <span className="ml-1 text-canvas underline underline-offset-2">Bekijk winkelwagen</span>
      </button>
    </div>
  );
}
