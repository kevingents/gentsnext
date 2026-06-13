"use client";

import { useState } from "react";

const THRESHOLDS = ["XL", "XXL", "3XL", "4XL", "5XL"];

export function SizeMediaForm() {
  const [form, setForm] = useState({ handle: "", kind: "model", threshold: "XXL", url: "", alt: "" });
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent, remove = false) {
    e.preventDefault();
    setState("busy");
    setMsg("");
    try {
      const r = await fetch("/api/account/size-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, remove }),
      });
      const d = await r.json();
      if (d.ok) {
        setState("done");
        setMsg(remove ? "Grote-maat-foto verwijderd." : "Opgeslagen — zichtbaar op de productpagina.");
      } else {
        setState("fail");
        setMsg(d.error || "Mislukt.");
      }
    } catch {
      setState("fail");
      setMsg("Mislukt.");
    }
  }

  return (
    <form onSubmit={(e) => submit(e)} className="mt-8 space-y-4">
      <label className="block">
        <span className="font-sans text-sm">Product-handle</span>
        <input
          value={form.handle}
          onChange={(e) => setForm((p) => ({ ...p, handle: e.target.value.trim() }))}
          placeholder="bijv. colbert-sjas-blauw"
          className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
        />
        <span className="mt-1 block font-sans text-xs text-muted">Het laatste deel van de product-URL (/products/<strong>…</strong>).</span>
      </label>

      <div className="inline-flex overflow-hidden rounded-card border border-line text-sm">
        {[
          { v: "model", label: "Reguliere modelfoto" },
          { v: "large", label: "Grote-maat-foto" },
        ].map((k) => (
          <button
            key={k.v}
            type="button"
            onClick={() => setForm((p) => ({ ...p, kind: k.v }))}
            className={`px-3 py-1.5 font-sans transition-colors ${form.kind === k.v ? "bg-ink text-canvas" : "text-ink-soft hover:text-ink"}`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {form.kind === "large" ? (
        <label className="block">
          <span className="font-sans text-sm">Vanaf maat</span>
          <select
            value={form.threshold}
            onChange={(e) => setForm((p) => ({ ...p, threshold: e.target.value }))}
            className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
          >
            {THRESHOLDS.map((t) => (
              <option key={t} value={t}>{t} en groter</option>
            ))}
          </select>
        </label>
      ) : (
        <p className="font-sans text-xs text-muted">De reguliere modelfoto leidt de productgalerij (model eerst).</p>
      )}

      <label className="block">
        <span className="font-sans text-sm">Afbeeldings-URL (grote maat)</span>
        <input
          value={form.url}
          onChange={(e) => setForm((p) => ({ ...p, url: e.target.value.trim() }))}
          placeholder="https://…"
          className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="font-sans text-sm">Alt-tekst (optioneel)</span>
        <input
          value={form.alt}
          onChange={(e) => setForm((p) => ({ ...p, alt: e.target.value }))}
          className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
        />
      </label>

      {form.url ? (
        <div className="border border-line p-3">
          <p className="mb-2 font-sans text-xs text-muted">Voorbeeld</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={form.url} alt="" className="max-h-48 rounded-card object-cover" />
        </div>
      ) : null}

      {msg ? <p className={`font-sans text-sm ${state === "fail" ? "text-danger" : "text-success"}`}>{msg}</p> : null}

      <div className="flex gap-3">
        <button type="submit" disabled={state === "busy"} className="btn-primary">
          {state === "busy" ? "Bezig…" : "Opslaan"}
        </button>
        <button type="button" onClick={(e) => submit(e, true)} disabled={state === "busy"} className="btn-ghost">
          Verwijder voor dit product
        </button>
      </div>
    </form>
  );
}
