"use client";

import { useState } from "react";
import { useCart, type CartLine } from "@/components/cart/cart-context";

type Addable = Omit<CartLine, "id">;

/**
 * "Bestel opnieuw": haalt de huidige, leverbare regels van een eerdere order op
 * en legt ze in de winkelwagen (opent de cart-drawer). Toont wat niet meer leverbaar is.
 */
export function ReorderButton({ orderNumber, token, className }: { orderNumber: string; token?: string; className?: string }) {
  const cart = useCart();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function run() {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/account/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderNumber, token }),
      });
      const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; addable?: Addable[]; unavailable?: string[] } | null;
      if (!res.ok || !d?.ok) {
        setMsg(d?.error || "Opnieuw bestellen mislukt.");
        return;
      }
      const addable = d.addable ?? [];
      if (!addable.length) {
        setMsg("Geen van deze artikelen is nog leverbaar.");
        return;
      }
      for (const line of addable) cart.add(line, { quiet: true });
      cart.open();
      if (d.unavailable?.length) setMsg(`${d.unavailable.length} artikel(en) niet meer leverbaar — de rest staat in je winkelwagen.`);
    } catch {
      setMsg("Netwerkfout.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <button type="button" onClick={run} disabled={busy} className="btn-ghost">
        {busy ? "Toevoegen…" : "Bestel opnieuw"}
      </button>
      {msg ? <p className="mt-1 font-sans text-xs text-muted">{msg}</p> : null}
    </div>
  );
}
