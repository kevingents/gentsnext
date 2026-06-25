"use client";

import { useState } from "react";

type Line = { orderLineId: string; sku: string; title: string; size: string; color: string; unitPriceCents: number; orderedQty: number; returnableQty: number };
type Policy = { windowDays: number; dhlReturnCostCents: number; freeOnCredit: boolean };
type Created = {
  ok: boolean; id?: string; status?: string; itemsCents?: number; shippingCostCents?: number;
  refundType?: "money" | "credit"; method?: "dhl" | "store"; labelPending?: boolean;
  label?: { url: string; base64: string; tracking: string } | null; error?: string;
};

const euro = (c: number) => "€ " + (c / 100).toFixed(2).replace(".", ",");
const inputCls = "w-full rounded-lg border border-line px-3 py-2.5 text-base text-ink outline-none focus:border-ink";

type Prefill = { orderNumber: string; email: string; lines: Line[]; policy: Policy; withinWindow: boolean };

export function RetourFlow({ initialOrder = "", prefill }: { initialOrder?: string; prefill?: Prefill | null }) {
  // Ingelogd vanaf de bestelpagina (prefill) → direct naar de artikelkeuze, géén e-mail nodig.
  const authed = Boolean(prefill);
  const [step, setStep] = useState<"lookup" | "select" | "done">(prefill ? "select" : "lookup");
  const [orderNumber, setOrderNumber] = useState(prefill?.orderNumber ?? initialOrder);
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [lines, setLines] = useState<Line[]>(prefill?.lines ?? []);
  const [policy, setPolicy] = useState<Policy | null>(prefill?.policy ?? null);
  const [withinWindow, setWithinWindow] = useState(prefill?.withinWindow ?? true);
  const [qty, setQty] = useState<Record<string, number>>(prefill ? Object.fromEntries(prefill.lines.map((l) => [l.orderLineId, 0])) : {});
  const [method, setMethod] = useState<"dhl" | "store">("dhl");
  const [refundType, setRefundType] = useState<"money" | "credit">("credit");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<Created | null>(null);

  async function lookup() {
    setErr(""); setBusy(true);
    try {
      const r = await fetch("/api/returns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "lookup", orderNumber, email }) });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || "Niet gevonden.");
      const retLines = (d.lines as Line[]).filter((l) => l.returnableQty > 0);
      if (!retLines.length) throw new Error("Voor deze bestelling is niets (meer) te retourneren.");
      setLines(retLines); setPolicy(d.policy); setWithinWindow(d.withinWindow);
      setQty(Object.fromEntries(retLines.map((l) => [l.orderLineId, 0])));
      setStep("select");
    } catch (e) { setErr(e instanceof Error ? e.message : "Er ging iets mis."); } finally { setBusy(false); }
  }

  const selected = lines.filter((l) => (qty[l.orderLineId] || 0) > 0);
  const itemsCents = selected.reduce((s, l) => s + (qty[l.orderLineId] || 0) * l.unitPriceCents, 0);
  const free = method === "store" || (refundType === "credit" && (policy?.freeOnCredit ?? true));
  const shipCost = free ? 0 : policy?.dhlReturnCostCents ?? 0;

  async function submit() {
    setErr(""); setBusy(true);
    try {
      const items = selected.map((l) => ({ orderLineId: l.orderLineId, qty: qty[l.orderLineId] }));
      const r = await fetch("/api/returns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", orderNumber, email, items, method, refundType, reason }) });
      const d = (await r.json()) as Created;
      if (!r.ok || !d.ok) throw new Error(d.error || "Aanmaken mislukt.");
      setResult(d); setStep("done");
    } catch (e) { setErr(e instanceof Error ? e.message : "Er ging iets mis."); } finally { setBusy(false); }
  }

  /* ── Stap 1: opzoeken ───────────────────────────────────────────── */
  if (step === "lookup") {
    return (
      <div className="space-y-4">
        <p className="font-sans text-ink-soft">Vul je bestelnummer en e-mailadres in om een retour te starten.</p>
        <div className="grid gap-3 sm:max-w-md">
          <input className={inputCls} placeholder="Bestelnummer (bv. G123ABC)" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
          <input className={inputCls} placeholder="E-mailadres van de bestelling" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button onClick={lookup} disabled={busy || !orderNumber || !email} className="btn-primary disabled:opacity-50">{busy ? "Zoeken…" : "Bestelling zoeken"}</button>
        </div>
      </div>
    );
  }

  /* ── Stap 2: kiezen ─────────────────────────────────────────────── */
  if (step === "select") {
    return (
      <div className="space-y-5">
        {!withinWindow && <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">Let op: de retourtermijn ({policy?.windowDays} dagen) lijkt verstreken. Je kunt het wel proberen; we beoordelen het per geval.</div>}

        <section>
          <p className="label-brand mb-2">Welke artikelen retourneer je?</p>
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.orderLineId} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{l.title}</p>
                  <p className="text-xs text-ink-soft">{[l.color, l.size].filter(Boolean).join(" · ")} · {euro(l.unitPriceCents)}</p>
                </div>
                <select value={qty[l.orderLineId] || 0} onChange={(e) => setQty((p) => ({ ...p, [l.orderLineId]: Number(e.target.value) }))} className="rounded-lg border border-line px-2 py-1.5 text-base text-ink">
                  {Array.from({ length: l.returnableQty + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
            ))}
          </div>
        </section>

        <section>
          <p className="label-brand mb-2">Hoe lever je in?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button onClick={() => setMethod("dhl")} className={`rounded-xl border px-4 py-3 text-left ${method === "dhl" ? "border-ink bg-ink/5" : "border-line"}`}>
              <span className="block text-sm font-semibold text-ink">DHL-retourlabel</span>
              <span className="block text-xs text-ink-soft">We mailen je een retourlabel</span>
            </button>
            <button onClick={() => setMethod("store")} className={`rounded-xl border px-4 py-3 text-left ${method === "store" ? "border-ink bg-ink/5" : "border-line"}`}>
              <span className="block text-sm font-semibold text-ink">In de winkel</span>
              <span className="block text-xs text-ink-soft">Inleveren in een GENTS-winkel — altijd gratis</span>
            </button>
          </div>
        </section>

        <section>
          <p className="label-brand mb-2">Wat wil je terug?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button onClick={() => setRefundType("credit")} className={`rounded-xl border px-4 py-3 text-left ${refundType === "credit" ? "border-ink bg-ink/5" : "border-line"}`}>
              <span className="block text-sm font-semibold text-ink">Tegoed (omruilen) — gratis retour</span>
              <span className="block text-xs text-ink-soft">Je krijgt een GENTS-tegoed van {euro(itemsCents)} om iets nieuws te kiezen</span>
            </button>
            <button onClick={() => setRefundType("money")} className={`rounded-xl border px-4 py-3 text-left ${refundType === "money" ? "border-ink bg-ink/5" : "border-line"}`}>
              <span className="block text-sm font-semibold text-ink">Geld terug</span>
              <span className="block text-xs text-ink-soft">Terug op je betaalmethode{!free && policy ? ` (− ${euro(policy.dhlReturnCostCents)} retourkosten)` : ""}</span>
            </button>
          </div>
        </section>

        <textarea className={inputCls} rows={2} placeholder="Reden van retour (optioneel)" value={reason} onChange={(e) => setReason(e.target.value)} />

        <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <div className="flex justify-between text-ink-soft"><span>Waarde artikelen</span><span>{euro(itemsCents)}</span></div>
          <div className="flex justify-between text-ink-soft"><span>Retourkosten</span><span>{shipCost === 0 ? "gratis" : `− ${euro(shipCost)}`}</span></div>
          <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold text-ink"><span>{refundType === "credit" ? "Tegoed" : "Terug te ontvangen"}</span><span>{euro(refundType === "credit" ? itemsCents : Math.max(0, itemsCents - shipCost))}</span></div>
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-2">
          {authed ? (
            <a href="/account" className="btn-ghost">Terug</a>
          ) : (
            <button onClick={() => setStep("lookup")} className="btn-ghost">Terug</button>
          )}
          <button onClick={submit} disabled={busy || !selected.length} className="btn-primary disabled:opacity-50">{busy ? "Bezig…" : "Retour bevestigen"}</button>
        </div>
      </div>
    );
  }

  /* ── Stap 3: bevestiging ────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        Je retour is aangemeld{result?.refundType === "credit" ? " — je tegoed volgt zodra we de artikelen ontvangen hebben." : "."}
      </div>

      {result?.method === "dhl" && (
        result.label && (result.label.base64 || result.label.url) ? (
          <div className="space-y-2">
            <p className="text-sm text-ink-soft">Print je DHL-retourlabel en plak het op het pakket:</p>
            {result.label.base64
              ? <a href={`data:application/pdf;base64,${result.label.base64}`} download={`retourlabel-${orderNumber}.pdf`} className="btn-primary inline-block">Download retourlabel (PDF)</a>
              : <a href={result.label.url} target="_blank" rel="noopener noreferrer" className="btn-primary inline-block">Open retourlabel</a>}
            {result.label.tracking && <p className="text-xs text-ink-soft">Track &amp; trace: {result.label.tracking}</p>}
          </div>
        ) : (
          <p className="text-sm text-ink-soft">We sturen je het DHL-retourlabel zo per e-mail toe.</p>
        )
      )}

      {result?.method === "store" && (
        <p className="text-sm text-ink-soft">Lever de artikelen samen met je bestelnummer in bij een van onze GENTS-winkels. Inleveren is gratis.</p>
      )}

      <button onClick={() => { setStep("lookup"); setResult(null); setOrderNumber(""); setEmail(""); }} className="btn-ghost">Nieuwe retour</button>
    </div>
  );
}
