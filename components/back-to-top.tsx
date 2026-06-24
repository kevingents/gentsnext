"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/i18n/locale-provider";

/** Floating "naar boven"-knop op lange pagina's, verschijnt na 800px scrollen. */
export function BackToTop() {
  const t = useT();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 800);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label={t("backToTop.ariaLabel")}
      className="fixed bottom-6 right-6 z-30 hidden h-11 w-11 items-center justify-center rounded-full border border-line bg-canvas shadow-card transition-colors hover:border-ink lg:flex"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
