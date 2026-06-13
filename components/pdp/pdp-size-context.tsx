"use client";

import { createContext, useContext, useState } from "react";

/**
 * Deelt de gekozen maat-bucket tussen de buy-box (waar je kiest) en de galerij
 * (die de modelfoto kan aanpassen bij grote maten). Lettermaat-bucket, bv "XXL".
 */
type Ctx = { sizeLabel: string | null; setSizeLabel: (s: string | null) => void };
const C = createContext<Ctx>({ sizeLabel: null, setSizeLabel: () => {} });

export function PdpSizeProvider({ children }: { children: React.ReactNode }) {
  const [sizeLabel, setSizeLabel] = useState<string | null>(null);
  return <C.Provider value={{ sizeLabel, setSizeLabel }}>{children}</C.Provider>;
}

export function usePdpSize(): Ctx {
  return useContext(C);
}
