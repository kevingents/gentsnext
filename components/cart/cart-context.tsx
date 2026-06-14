"use client";

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { track } from "@/lib/track-client";

export type CartLine = {
  id: string; // uniek per variant (+ groep): sku of sku::groupId
  sku: string;
  productHandle: string;
  title: string;
  size: string;
  color: string;
  priceCents: number;
  imageUrl: string;
  qty: number;
  hoofdgroep?: string; // categorie (voor slimme bijverkoop)
  groupId?: string; // pak-onderdelen delen een groupId
  groupLabel?: string; // bv. "Pak — Stretch zwart"
  roleLabel?: string; // bv. "Colbert"
};

type CartState = {
  lines: CartLine[];
  isOpen: boolean;
  count: number;
  subtotalCents: number;
  add: (line: Omit<CartLine, "id">, opts?: { open?: boolean }) => void;
  addMany: (lines: Omit<CartLine, "id">[]) => void;
  remove: (id: string) => void;
  removeGroup: (groupId: string) => void;
  setQty: (id: string, qty: number) => void;
  clear: () => void;
  open: () => void;
  close: () => void;
};

const CartCtx = createContext<CartState | null>(null);
const STORAGE_KEY = "gents-cart-v1";

function lineId(l: Omit<CartLine, "id">): string {
  return l.groupId ? `${l.sku}::${l.groupId}` : l.sku;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrateren uit localStorage na mount (SSR-veilig).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setLines(JSON.parse(raw));
    } catch {
      /* corrupte opslag negeren */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* quota e.d. negeren */
    }
  }, [lines, hydrated]);

  const add = useCallback((line: Omit<CartLine, "id">, opts?: { open?: boolean }) => {
    const id = lineId(line);
    track("add_to_cart", { handle: line.productHandle, valueCents: line.priceCents * line.qty });
    setLines((prev) => {
      const existing = prev.find((l) => l.id === id);
      if (existing) return prev.map((l) => (l.id === id ? { ...l, qty: l.qty + line.qty } : l));
      return [...prev, { ...line, id }];
    });
    // De winkelwagen-drawer opent standaard (bv. PDP); bij het samenstellen van
    // een look (meerdere toevoegingen achter elkaar) zetten we open:false.
    if (opts?.open !== false) setIsOpen(true);
  }, []);

  const addMany = useCallback((newLines: Omit<CartLine, "id">[]) => {
    setLines((prev) => {
      const next = [...prev];
      for (const line of newLines) {
        const id = lineId(line);
        const idx = next.findIndex((l) => l.id === id);
        if (idx >= 0) next[idx] = { ...next[idx], qty: next[idx].qty + line.qty };
        else next.push({ ...line, id });
      }
      return next;
    });
    setIsOpen(true);
  }, []);

  const remove = useCallback((id: string) => setLines((prev) => prev.filter((l) => l.id !== id)), []);
  const removeGroup = useCallback(
    (groupId: string) => setLines((prev) => prev.filter((l) => l.groupId !== groupId)),
    []
  );
  const setQty = useCallback(
    (id: string, qty: number) =>
      setLines((prev) =>
        qty <= 0 ? prev.filter((l) => l.id !== id) : prev.map((l) => (l.id === id ? { ...l, qty } : l))
      ),
    []
  );
  const clear = useCallback(() => setLines([]), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const count = useMemo(() => lines.reduce((n, l) => n + l.qty, 0), [lines]);
  const subtotalCents = useMemo(() => lines.reduce((n, l) => n + l.priceCents * l.qty, 0), [lines]);

  const value: CartState = {
    lines,
    isOpen,
    count,
    subtotalCents,
    add,
    addMany,
    remove,
    removeGroup,
    setQty,
    clear,
    open,
    close,
  };

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(CartCtx);
  if (!ctx) throw new Error("useCart moet binnen CartProvider gebruikt worden.");
  return ctx;
}
