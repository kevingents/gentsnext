"use client";

import { useState } from "react";

/** Admin-knop: importeert de winkelaankopen van deze klant uit SRS (omnichannel). */
export function ImportStorePurchasesButton({ customerId }: { customerId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [msg, setMsg] = useState("");

  async function run() {
    setState("busy");
    setMsg("");
    try {
      const r = await fetch("/api/account/import-store-purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setState("fail");
        setMsg(d.error || "Import mislukt.");
        return;
      }
      setState("done");
      if (d.imported > 0) {
        setMsg(`${d.imported} aankoop(en) geïmporteerd — pagina verversen…`);
        setTimeout(() => window.location.reload(), 900);
      } else {
        setMsg(d.error || (d.srsCustomerId ? "Geen nieuwe aankopen (alles al gekoppeld)." : "Geen SRS-klant gevonden."));
      }
    } catch {
      setState("fail");
      setMsg("Import mislukt.");
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg ? <span className={`text-xs ${state === "fail" ? "text-red-700" : "text-pslate"}`}>{msg}</span> : null}
      <button
        type="button"
        onClick={run}
        disabled={state === "busy"}
        className="inline-flex items-center rounded-lg border border-pnavy-100 bg-white px-3 py-1.5 text-xs font-medium text-pnavy hover:bg-pnavy-50 disabled:opacity-50"
      >
        {state === "busy" ? "Importeren…" : "Importeer uit SRS"}
      </button>
    </div>
  );
}
