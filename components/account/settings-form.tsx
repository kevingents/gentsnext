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
  searchSynonyms: string;
  modelLook: {
    enabled: boolean;
    minStock: number;
    items: { handle: string; label: string; hoofdgroep: string; x: number; y: number }[];
  };
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

  type LookItem = Settings["modelLook"]["items"][number];
  function setLookItem(i: number, key: keyof LookItem, val: string | number) {
    setS((p) => ({
      ...p,
      modelLook: { ...p.modelLook, items: p.modelLook.items.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)) },
    }));
  }
  function addLookItem() {
    setS((p) => ({ ...p, modelLook: { ...p.modelLook, items: [...p.modelLook.items, { handle: "", label: "", hoofdgroep: "", x: 50, y: 50 }] } }));
  }
  function removeLookItem(i: number) {
    setS((p) => ({ ...p, modelLook: { ...p.modelLook, items: p.modelLook.items.filter((_, idx) => idx !== i) } }));
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

      <section>
        <p className="label-brand mb-2">Zoek-synoniemen</p>
        <p className="mb-2 font-sans text-xs text-muted">
          Eén groep per regel, komma-gescheiden. Woorden in dezelfde groep vinden
          elkaars producten (bv. <em>colbert, jasje, blazer</em>).
        </p>
        <textarea
          value={s.searchSynonyms}
          onChange={(e) => setS((p) => ({ ...p, searchSynonyms: e.target.value }))}
          rows={8}
          className="w-full resize-y border border-line bg-canvas px-3 py-2.5 font-mono text-xs focus:border-ink focus:outline-none"
        />
      </section>

      <section>
        <p className="label-brand mb-2">Shop de look (modelfoto)</p>
        <p className="mb-3 font-sans text-xs text-muted">
          De vaste basis-outfit die het AI-model draagt. Per modelfoto wordt het
          getoonde product hieraan toegevoegd → een klikbare, shoppbare look op de
          productpagina. <strong>x/y</strong> is de positie van het stipje op de
          foto (in %). Stukken met dezelfde hoofdgroep als het product worden
          automatisch weggelaten.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={s.modelLook.enabled}
              onChange={(e) => setS((p) => ({ ...p, modelLook: { ...p.modelLook, enabled: e.target.checked } }))}
              className="accent-ink"
            />
            <span className="font-sans text-sm">Shop de look tonen op modelfoto's</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="font-sans text-sm">Drempel "goed op voorraad"</span>
            <input
              type="number"
              min="0"
              value={s.modelLook.minStock}
              onChange={(e) => setS((p) => ({ ...p, modelLook: { ...p.modelLook, minStock: Math.max(0, Math.round(Number(e.target.value) || 0)) } }))}
              className="w-20 border border-line bg-canvas px-2 py-1.5 font-sans text-sm focus:border-ink focus:outline-none"
            />
            <span className="font-sans text-sm text-muted">stuks</span>
          </label>
        </div>
        <p className="mb-3 font-sans text-xs text-muted">
          Stukken onder deze drempel worden automatisch vervangen door een ruim
          leverbaar alternatief van dezelfde rol, in een passende kleur.
        </p>
        <div className="space-y-2">
          {s.modelLook.items.map((it, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 border border-line p-2 sm:grid-cols-[1fr_1.4fr_1fr_3.5rem_3.5rem_auto] sm:items-center sm:border-0 sm:p-0">
              <input value={it.label} onChange={(e) => setLookItem(i, "label", e.target.value)} placeholder="Label" className="border border-line bg-canvas px-2 py-1.5 font-sans text-sm focus:border-ink focus:outline-none" />
              <input value={it.handle} onChange={(e) => setLookItem(i, "handle", e.target.value.trim())} placeholder="product-handle" className="border border-line bg-canvas px-2 py-1.5 font-sans text-sm focus:border-ink focus:outline-none" />
              <input value={it.hoofdgroep} onChange={(e) => setLookItem(i, "hoofdgroep", e.target.value)} placeholder="Hoofdgroep" className="border border-line bg-canvas px-2 py-1.5 font-sans text-sm focus:border-ink focus:outline-none" />
              <input type="number" min="0" max="100" value={it.x} onChange={(e) => setLookItem(i, "x", Math.round(Number(e.target.value) || 0))} title="x %" className="border border-line bg-canvas px-2 py-1.5 font-sans text-sm focus:border-ink focus:outline-none" />
              <input type="number" min="0" max="100" value={it.y} onChange={(e) => setLookItem(i, "y", Math.round(Number(e.target.value) || 0))} title="y %" className="border border-line bg-canvas px-2 py-1.5 font-sans text-sm focus:border-ink focus:outline-none" />
              <button type="button" onClick={() => removeLookItem(i)} className="font-sans text-sm text-danger underline">Verwijder</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addLookItem} className="mt-3 border border-line px-3 py-1.5 font-sans text-sm hover:border-ink">
          Stuk toevoegen
        </button>
      </section>

      {msg ? <p className={`font-sans text-sm ${state === "fail" ? "text-danger" : "text-success"}`}>{msg}</p> : null}
      <button type="submit" disabled={state === "busy"} className="btn-primary">
        {state === "busy" ? "Opslaan…" : "Instellingen opslaan"}
      </button>
    </form>
  );
}
