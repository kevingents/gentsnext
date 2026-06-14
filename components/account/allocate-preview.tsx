"use client";

import { useState } from "react";

type ShipmentLine = { sku: string; qty: number; title?: string };
type Shipment = {
  branchId: string;
  store: string;
  isWarehouse: boolean;
  dispatchLabel: string;
  dispatchInDays: number;
  lines: ShipmentLine[];
  units: number;
};
type Plan = {
  shipments: Shipment[];
  splitCount: number;
  fullyAllocated: boolean;
  shortages: { sku: string; qtyShort: number; title?: string }[];
  strategy: string;
};

const STRATEGY_NL: Record<string, string> = {
  "single-source": "Eén bron (magazijn-eerst)",
  "least-split": "Zo min mogelijk splitsen",
  unfulfillable: "Niet leverbaar",
};

export function AllocatePreview() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [unknown, setUnknown] = useState<string[]>([]);

  async function run() {
    setError("");
    setPlan(null);
    setBusy(true);
    try {
      const r = await fetch("/api/account/allocate-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const d = await r.json();
      if (!d.ok) {
        setError(d.error || "Er ging iets mis.");
        return;
      }
      setPlan(d.plan);
      setUnknown(d.unknownSkus || []);
    } catch {
      setError("Kon de allocatie niet berekenen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-pnavy-100 bg-white p-5 shadow-portal">
        <p className="text-xs font-semibold uppercase tracking-wider text-pslate">Test-order</p>
        <p className="mt-1 text-sm text-pslate">
          Plak één of meer <strong className="text-pnavy">SKU&apos;s</strong> (één per regel, optioneel met aantal: <code className="rounded bg-pnavy-50 px-1">SKU 2</code>). We tonen waar deze order heen zou gaan — magazijn-eerst, zo min mogelijk splitsen, met levertijd — <strong className="text-pnavy">zonder iets naar SRS te sturen</strong>.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={"bv.\nARTIKEL-50-NAVY 1\nARTIKEL-33-NAVY"}
          className="mt-3 w-full rounded-lg border border-pnavy-100 bg-white px-3 py-2 font-mono text-sm text-pnavy focus:border-pnavy-600 focus:outline-none"
        />
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={run} disabled={busy || !text.trim()} className="inline-flex items-center rounded-lg bg-pnavy px-4 py-2 text-sm font-medium text-cream hover:bg-pnavy-700 disabled:opacity-50">
            {busy ? "Berekenen…" : "Bekijk waar deze order heen gaat"}
          </button>
          {error ? <span className="text-sm text-red-700">{error}</span> : null}
        </div>
      </div>

      {plan ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Pill tone={plan.fullyAllocated ? "green" : "red"}>{plan.fullyAllocated ? "Volledig leverbaar" : "Tekort — handmatige review"}</Pill>
            <Pill tone="blue">{plan.splitCount} zending{plan.splitCount === 1 ? "" : "en"}</Pill>
            <Pill tone="neutral">{STRATEGY_NL[plan.strategy] || plan.strategy}</Pill>
          </div>

          {plan.shipments.map((s, i) => (
            <div key={s.branchId + i} className="rounded-xl border border-pnavy-100 bg-white p-5 shadow-portal">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-pnavy">{s.store || `Filiaal ${s.branchId}`}</span>
                  <Pill tone={s.isWarehouse ? "blue" : "neutral"}>{s.isWarehouse ? "Magazijn" : "Winkel"}</Pill>
                </div>
                <span className="text-xs text-pslate">Verzendt {s.dispatchLabel} · {s.units} artikel{s.units === 1 ? "" : "en"}</span>
              </div>
              <ul className="mt-3 divide-y divide-pnavy-50">
                {s.lines.map((l, j) => (
                  <li key={l.sku + j} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <span className="min-w-0 truncate text-pnavy">{l.title || l.sku}</span>
                    <span className="shrink-0 tabular-nums text-pslate">{l.qty} × <code className="text-xs">{l.sku}</code></span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {plan.shortages.length ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5">
              <p className="text-sm font-semibold text-red-700">Niet (volledig) leverbaar</p>
              <ul className="mt-2 space-y-1 text-sm text-red-700">
                {plan.shortages.map((sh, i) => (
                  <li key={sh.sku + i}>{sh.qtyShort}× tekort — {sh.title || sh.sku} (<code className="text-xs">{sh.sku}</code>)</li>
                ))}
              </ul>
            </div>
          ) : null}

          {unknown.length ? (
            <p className="text-sm text-pslate">Onbekende SKU&apos;s (niet in catalogus): <code className="text-xs">{unknown.join(", ")}</code></p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: "green" | "red" | "blue" | "neutral" }) {
  const cls =
    tone === "green" ? "bg-emerald-50 text-emerald-700" : tone === "red" ? "bg-red-50 text-red-700" : tone === "blue" ? "bg-sky-50 text-sky-700" : "bg-pnavy-50 text-pslate";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}
