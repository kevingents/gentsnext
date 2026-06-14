"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polt de order-status terwijl de betaling 'open' is en ververst de pagina
 * zodra de Mollie-webhook de order heeft bijgewerkt — zo springt de
 * bedanktpagina vanzelf van "we bevestigen je betaling" naar "bevestigd",
 * zonder dat de klant hoeft te verversen.
 */
export function OrderStatusPoller({ orderNumber, token }: { orderNumber: string; token?: string }) {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    const qs = new URLSearchParams({ orderNumber });
    if (token) qs.set("t", token);

    const interval = setInterval(async () => {
      try {
        const r = await fetch(`/api/order-status?${qs.toString()}`, { cache: "no-store" });
        const d = await r.json();
        if (active && d.ok && d.status && d.status !== "open") {
          clearInterval(interval);
          router.refresh();
        }
      } catch {
        /* stil — volgende tick probeert opnieuw */
      }
    }, 3000);

    // Stop met pollen na ~2 minuten (dan is de webhook vrijwel zeker geweest).
    const stop = setTimeout(() => clearInterval(interval), 120000);

    return () => {
      active = false;
      clearInterval(interval);
      clearTimeout(stop);
    };
  }, [orderNumber, token, router]);

  return (
    <p className="mt-4 flex items-center gap-2 font-sans text-sm text-muted">
      <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin text-ink" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M21 12a9 9 0 1 1-6.2-8.5" strokeLinecap="round" />
      </svg>
      We controleren je betaling — dit gaat vanzelf.
    </p>
  );
}
