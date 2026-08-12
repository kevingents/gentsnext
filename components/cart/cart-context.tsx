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
    // Dit is het ENIGE punt waar add_to_cart afgaat. De look-componenten
    // vuurden het er vroeger nog een keer overheen ná deze aanroep, waardoor
    // elke toevoeging vanuit een look dubbel telde — één keer mét bedrag en één
    // keer zonder. Wie een extra kenmerk wil meegeven (bv. uit welke look),
    // geeft dat mee via `line`, niet via een tweede event.
    track("add_to_cart", {
      handle: line.productHandle,
      valueCents: line.priceCents * line.qty,
      props: {
        title: line.title, size: line.size, color: line.color, qty: line.qty,
        ...(line.groupId ? { groupId: line.groupId } : {}),
      },
    });
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
    // Een complete look in één keer: één event per regel, zodat de meting
    // hetzelfde telt als bij losse toevoegingen. `fromLook` maakt achteraf
    // zichtbaar wat de looks daadwerkelijk opleveren.
    for (const line of newLines) {
      track("add_to_cart", {
        handle: line.productHandle,
        valueCents: line.priceCents * line.qty,
        props: { title: line.title, size: line.size, color: line.color, qty: line.qty, fromLook: true },
      });
    }
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

  // Wegnemen is net zo veelzeggend als toevoegen: een product dat structureel de
  // wagen weer uit gaat heeft een prijs-, maat- of leverprobleem. Dat konden we
  // tot nu toe niet zien, want er werd alleen geteld wat eríngaat.
  const remove = useCallback(
    (id: string) =>
      setLines((prev) => {
        const weg = prev.find((l) => l.id === id);
        if (weg) {
          track("remove_from_cart", {
            handle: weg.productHandle,
            valueCents: weg.priceCents * weg.qty,
            props: { title: weg.title, size: weg.size, color: weg.color, qty: weg.qty },
          });
        }
        return prev.filter((l) => l.id !== id);
      }),
    []
  );
  const removeGroup = useCallback(
    (groupId: string) =>
      setLines((prev) => {
        for (const l of prev.filter((x) => x.groupId === groupId)) {
          track("remove_from_cart", {
            handle: l.productHandle,
            valueCents: l.priceCents * l.qty,
            props: { title: l.title, size: l.size, qty: l.qty, groupId },
          });
        }
        return prev.filter((l) => l.groupId !== groupId);
      }),
    []
  );
  const setQty = useCallback(
    (id: string, qty: number) =>
      setLines((prev) => {
        const huidig = prev.find((l) => l.id === id);
        if (huidig && qty !== huidig.qty) {
          // Naar 0 is een verwijdering, geen wijziging — anders mist GA4 het
          // remove_from_cart-signaal bij de meest gebruikte manier om iets uit
          // de wagen te halen.
          if (qty <= 0) {
            track("remove_from_cart", {
              handle: huidig.productHandle,
              valueCents: huidig.priceCents * huidig.qty,
              props: { title: huidig.title, size: huidig.size, qty: huidig.qty },
            });
          } else {
            track("aantal_gewijzigd", {
              handle: huidig.productHandle,
              valueCents: huidig.priceCents * qty,
              props: { van: huidig.qty, naar: qty, title: huidig.title },
            });
          }
        }
        return qty <= 0 ? prev.filter((l) => l.id !== id) : prev.map((l) => (l.id === id ? { ...l, qty } : l));
      }),
    []
  );
  const clear = useCallback(() => setLines([]), []);
  const open = useCallback(() => {
    // cart_view stond wél in de toegestane lijst maar werd nergens gevuurd —
    // de stap tussen "in de wagen" en "checkout gestart" ontbrak dus volledig in
    // de funnel, terwijl daar juist de grootste afhaak zit.
    setLines((prev) => {
      track("cart_view", {
        valueCents: prev.reduce((n, l) => n + l.priceCents * l.qty, 0),
        props: { regels: prev.length, stuks: prev.reduce((n, l) => n + l.qty, 0) },
      });
      return prev;
    });
    setIsOpen(true);
  }, []);
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
