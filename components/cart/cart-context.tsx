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

/** Korte "toegevoegd aan winkelwagen"-bevestiging (site-breed, i.p.v. de drawer openklappen). */
export type AddedNotice = { line: CartLine; extraCount: number; nonce: number };
/** Subtiele toast (bv. vanuit een look) i.p.v. de grote bevestig-modal. */
export type CartToast = { title: string; nonce: number };

type CartState = {
  lines: CartLine[];
  isOpen: boolean;
  count: number;
  subtotalCents: number;
  /** true zodra localStorage is ingelezen — daarvóór is `lines` nog leeg en zegt
      "winkelwagen is leeg" niets (voorkomt de lege-staat-flits bij verversen). */
  hydrated: boolean;
  added: AddedNotice | null;
  toast: CartToast | null;
  add: (line: Omit<CartLine, "id">, opts?: { quiet?: boolean }) => void;
  addMany: (lines: Omit<CartLine, "id">[]) => void;
  remove: (id: string) => void;
  removeGroup: (groupId: string) => void;
  setQty: (id: string, qty: number) => void;
  clear: () => void;
  open: () => void;
  close: () => void;
  dismissAdded: () => void;
  dismissToast: () => void;
};

const CartCtx = createContext<CartState | null>(null);
const STORAGE_KEY = "gents-cart-v1";

function lineId(l: Omit<CartLine, "id">): string {
  return l.groupId ? `${l.sku}::${l.groupId}` : l.sku;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [added, setAdded] = useState<AddedNotice | null>(null);
  const [toast, setToast] = useState<CartToast | null>(null);
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

  const add = useCallback((line: Omit<CartLine, "id">, opts?: { quiet?: boolean }) => {
    const id = lineId(line);
    track("add_to_cart", { handle: line.productHandle, valueCents: line.priceCents * line.qty });
    setLines((prev) => {
      const existing = prev.find((l) => l.id === id);
      if (existing) return prev.map((l) => (l.id === id ? { ...l, qty: l.qty + line.qty } : l));
      return [...prev, { ...line, id }];
    });
    // quiet (bv. vanuit een look): subtiele toast i.p.v. de grote bevestig-modal.
    if (opts?.quiet) setToast((prev) => ({ title: line.title, nonce: (prev?.nonce ?? 0) + 1 }));
    else setAdded((prev) => ({ line: { ...line, id }, extraCount: 0, nonce: (prev?.nonce ?? 0) + 1 }));
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
    if (newLines[0]) {
      const first = newLines[0];
      setAdded((prev) => ({ line: { ...first, id: lineId(first) }, extraCount: newLines.length - 1, nonce: (prev?.nonce ?? 0) + 1 }));
    }
  }, []);

  const dismissAdded = useCallback(() => setAdded(null), []);
  const dismissToast = useCallback(() => setToast(null), []);

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
    hydrated,
    added,
    toast,
    add,
    addMany,
    remove,
    removeGroup,
    setQty,
    clear,
    open,
    close,
    dismissAdded,
    dismissToast,
  };

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(CartCtx);
  if (!ctx) throw new Error("useCart moet binnen CartProvider gebruikt worden.");
  return ctx;
}
