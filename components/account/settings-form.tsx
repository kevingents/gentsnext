"use client";

import { useState } from "react";

type Settings = {
  freeShippingCents: number;
  shippingCents: number;
  expressSurchargeCents: number;
  warehouseCutoffHour: number;
  storeCutoffHour: number;
  branchCutoffs: Record<string, number>;
  standardMinDays: number;
  standardMaxDays: number;
  warehouseTransitDays: number;
  storeExtraDays: number;
  expressTransitDays: number;
  retailSafetyStock: number;
  warehouseSafetyStock: number;
  protectUnderstockedRetail: boolean;
};

/** Groepen velden — euro's tonen we in euro (×100 bij opslaan). */
const SECTIONS: { title: string; fields: { key: keyof Settings; label: string; kind: "euro" | "uur" | "dagen" | "stuks" }[] }[] = [
  {
    title: "Verzendkosten",
    fields: [
      { key: "freeShippingCents", label: "Gratis verzending vanaf", kind: "euro" },
      { key: "shippingCents", label: "Verzendkosten onder drempel", kind: "euro" },
      { key: "expressSurchargeCents", label: "Toeslag snellere levering", kind: "euro" },
    ],
  },
  {
    title: "Verzend-cutoff (NL-tijd)",
    fields: [
      { key: "warehouseCutoffHour", label: "Cutoff magazijn (uur)", kind: "uur" },
      { key: "storeCutoffHour", label: "Cutoff winkels (uur)", kind: "uur" },
    ],
  },
  {
    title: "Levertijd (werkdagen)",
    fields: [
      { key: "warehouseTransitDays", label: "Transit magazijn → klant", kind: "dagen" },
      { key: "storeExtraDays", label: "Extra dagen bij winkel/split", kind: "dagen" },
      { key: "expressTransitDays", label: "Transit snellere levering", kind: "dagen" },
      { key: "standardMinDays", label: "Standaard min. (weergave)", kind: "dagen" },
      { key: "standardMaxDays", label: "Standaard max. (weergave)", kind: "dagen" },
    ],
  },
  {
    title: "Voorraad-bescherming",
    fields: [
      { key: "retailSafetyStock", label: "Veiligheidsvoorraad winkel", kind: "stuks" },
      { key: "warehouseSafetyStock", label: "Veiligheidsvoorraad magazijn", kind: "stuks" },
    ],
  },
];

export function SettingsForm({ initial }: { initial: Settings }) {
  const [s, setS] = useState<Settings>(initial);
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [msg, setMsg] = useState("");

  function setField(key: keyof Settings, raw: string, kind: string) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const val = kind === "euro" ? Math.round(n * 100) : Math.round(n);
    setS((p) => ({ ...p, [key]: val }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    try {
      const r = await fetch("/api/account/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        setState("done");
        setMsg("Opgeslagen — werkt binnen 30 sec door in de hele winkel.");
      } else {
        setState("fail");
        setMsg(d.error || "Opslaan mislukte.");
      }
    } catch {
      setState("fail");
      setMsg("Opslaan mislukte.");
    }
  }

  return (
    <form onSubmit={save} className="mt-8 space-y-8">
      {SECTIONS.map((sec) => (
        <section key={sec.title}>
          <p className="label-brand mb-3">{sec.title}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {sec.fields.map((f) => {
              const cur = s[f.key] as number;
              const display = f.kind === "euro" ? (cur / 100).toString() : String(cur);
              return (
                <label key={String(f.key)} className="block">
                  <span className="font-sans text-sm">{f.label}</span>
                  <div className="mt-1 flex items-center gap-2">
                    {f.kind === "euro" ? <span className="font-sans text-sm text-muted">€</span> : null}
                    <input
                      type="number"
                      step={f.kind === "euro" ? "0.01" : "1"}
                      min="0"
                      defaultValue={display}
                      onChange={(e) => setField(f.key, e.target.value, f.kind)}
                      className="w-full border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none"
                    />
                    {f.kind === "uur" ? <span className="font-sans text-sm text-muted">:00</span> : null}
                  </div>
                </label>
              );
            })}
          </div>
        </section>
      ))}

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={s.protectUnderstockedRetail}
          onChange={(e) => setS((p) => ({ ...p, protectUnderstockedRetail: e.target.checked }))}
          className="accent-ink"
        />
        <span className="font-sans text-sm">Onderbevoorrade winkels (tekort) niet laten meeleveren</span>
      </label>

      {msg ? <p className={`font-sans text-sm ${state === "fail" ? "text-danger" : "text-success"}`}>{msg}</p> : null}
      <button type="submit" disabled={state === "busy"} className="btn-primary">
        {state === "busy" ? "Opslaan…" : "Instellingen opslaan"}
      </button>
    </form>
  );
}
