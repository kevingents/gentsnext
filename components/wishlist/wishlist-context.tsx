"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const KEY = "gents-wishlist-v1";

type Ctx = {
  handles: string[];
  hydrated: boolean;
  has: (handle: string) => boolean;
  toggle: (handle: string) => void;
  remove: (handle: string) => void;
  clear: () => void;
  count: number;
};

const C = createContext<Ctx | null>(null);

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [handles, setHandles] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setHandles(JSON.parse(raw));
    } catch {
      /* leeg */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(handles));
    } catch {
      /* quota */
    }
  }, [handles, hydrated]);

  const has = useCallback((h: string) => handles.includes(h), [handles]);
  const toggle = useCallback((h: string) => {
    setHandles((prev) => (prev.includes(h) ? prev.filter((x) => x !== h) : [h, ...prev].slice(0, 200)));
  }, []);
  const remove = useCallback((h: string) => setHandles((prev) => prev.filter((x) => x !== h)), []);
  const clear = useCallback(() => setHandles([]), []);

  const value = useMemo(
    () => ({ handles, hydrated, has, toggle, remove, clear, count: handles.length }),
    [handles, hydrated, has, toggle, remove, clear]
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useWishlist(): Ctx {
  const ctx = useContext(C);
  if (!ctx) throw new Error("useWishlist moet binnen WishlistProvider");
  return ctx;
}
