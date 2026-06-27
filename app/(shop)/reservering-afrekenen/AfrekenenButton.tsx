"use client";

import { useState } from "react";

/** "Betaal nu" → start de Mollie-betaling en stuur de klant naar de checkout. */
export function AfrekenenButton({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pay() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/reservering/afrekenen", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; checkoutUrl?: string; alreadyDone?: boolean; error?: string };
      if (d.alreadyDone) { window.location.reload(); return; }
      if (!res.ok || !d.ok || !d.checkoutUrl) throw new Error(d.error || "Betaling kon niet starten.");
      window.location.href = d.checkoutUrl;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Er ging iets mis.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <button onClick={pay} disabled={busy} className="w-full rounded-lg bg-neutral-900 py-3 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? "Bezig…" : "Nu online afrekenen"}
      </button>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  );
}
