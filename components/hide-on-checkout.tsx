"use client";

import { usePathname } from "next/navigation";

/**
 * Verbergt zijn children op de checkout (/afrekenen, ook met locale-prefix). De
 * grote marketing-footer hoort niet op de afrekenpagina: die duwt de checkout van
 * het scherm en verlaagt zo de conversie. De server-component-children worden nog
 * gerenderd maar niet getoond op de checkout.
 */
export function HideOnCheckout({ children }: { children: React.ReactNode }) {
  const p = usePathname() || "";
  if (/(^|\/)afrekenen(\/|$)/.test(p)) return null;
  return <>{children}</>;
}
