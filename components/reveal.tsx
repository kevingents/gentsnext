"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Subtiele "reveal on scroll": fade + lichte opwaartse beweging zodra het element
 * in beeld komt (één keer). Respecteert prefers-reduced-motion via globals.css.
 * `delay` (ms) maakt een staggered effect mogelijk in een grid.
 */
export function Reveal({
  children,
  className = "",
  delay = 0,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "li" | "article";
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={`transition-all duration-700 ease-out ${shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"} ${className}`}
    >
      {children}
    </Tag>
  );
}
