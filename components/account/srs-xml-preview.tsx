"use client";

import { useState } from "react";

type Weborder = { branchId: string; store: string; orderId: string; xml: string };
type Resp = {
  ok: boolean;
  error?: string;
  orderNumber?: string;
  fullyAllocated?: boolean;
  splitCount?: number;
  credsPresent?: boolean;
  pushEnabled?: boolean;
  weborders?: Weborder[];
};

export function SrsXmlPreview() {
  const [order, setOrder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [res, setRes] = useState<Resp | null>(null);

  async function run() {
    setError("");
    setRes(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/account/srs-preview?order=${encodeURIComponent(order.trim())}`);
      const d: Resp = await r.json();
      if (!d.ok) {
        setError(d.error || "Er ging iets mis.");
        return;
      }
      setRes(d);
    } catch {
      setError("Kon de SRS-preview niet laden.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-pnavy-100 bg-white p-5 shadow-portal">
        <p className="text-xs font-semibold uppercase tracking-wider text-pslate">SRS-weborder-preview</p>
        <p className="mt-1 text-sm text-pslate">
          Geef een bestaand <strong className="text-pnavy">ordernummer</strong> (bv. <code className="rounded bg-pnavy-50 px-1">G…</code>) en zie de exacte SRS-weborder-XML die per zending zou worden verstuurd — <strong className="text-pnavy">zonder iets naar SRS te pushen</strong>. Ideaal om bij SRS te valideren vóór de koppeling aangaat.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(); }}
            placeholder="G3KQ9X12A"
            className="w-56 rounded-lg border border-pnavy-100 bg-white px-3 py-2 font-mono text-sm text-pnavy focus:border-pnavy-600 focus:outline-none"
          />
          <button type="button" onClick={run} disabled={busy || !order.trim()} className="inline-flex items-center rounded-lg bg-pnavy px-4 py-2 text-sm font-medium text-cream hover:bg-pnavy-700 disabled:opacity-50">
            {busy ? "Laden…" : "Toon SRS-XML"}
          </button>
          {error ? <span className="text-sm text-red-700">{error}</span> : null}
        </div>
      </div>

      {res ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={`rounded-full px-2.5 py-0.5 font-medium ${res.pushEnabled ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
              {res.pushEnabled ? "SRS-push staat AAN" : "SRS-push staat UIT (veilig)"}
            </span>
            <span className={`rounded-full px-2.5 py-0.5 font-medium ${res.credsPresent ? "bg-sky-50 text-sky-700" : "bg-pnavy-50 text-pslate"}`}>
              {res.credsPresent ? "Credentials aanwezig" : "Geen credentials"}
            </span>
            <span className="rounded-full bg-pnavy-50 px-2.5 py-0.5 font-medium text-pslate">{res.splitCount} weborder(s)</span>
            {!res.fullyAllocated ? <span className="rounded-full bg-red-50 px-2.5 py-0.5 font-medium text-red-700">Niet volledig leverbaar</span> : null}
          </div>
          {(res.weborders || []).map((w, i) => (
            <div key={w.orderId + i} className="rounded-xl border border-pnavy-100 bg-white p-4 shadow-portal">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-semibold text-pnavy">{w.store || `Filiaal ${w.branchId}`}</span>
                <code className="text-xs text-pslate">orderid: {w.orderId}</code>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-pnavy-50/60 p-3 text-xs leading-relaxed text-pnavy">{w.xml}</pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
