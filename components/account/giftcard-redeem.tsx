"use client";

import { useState } from "react";
import { formatEuro } from "@/lib/pricing";
import { btnPrimary, btnSecondary } from "@/components/account/report-ui";

type Tx = { deltaCents: number; reason: string; orderNumber: string; at: string };
type Info = {
  found: boolean;
  code: string;
  status?: string;
  initialCents?: number;
  balanceCents?: number;
  expiresAt?: string | null;
  recipientName?: string;
  transactions?: Tx[];
};

const FIELD = "w-full rounded-lg border border-pnavy-100 bg-white px-3 py-2 text-sm text-pnavy focus:border-pnavy-600 focus:outline-none";
const REASON_LABEL: Record<string, string> = { issue: "Uitgegeven", redeem: "Verzilverd", release: "Teruggeboekt" };

export function GiftcardRedeem() {
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function lookup(e?: React.FormEvent) {
    e?.preventDefault();
    setErr(""); setMsg(""); setInfo(null);
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    try {
      const r = await fetch("/api/account/giftcard/lookup", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: c }),
      });
      const d: Info = await r.json();
      if (!r.ok) { setErr((d as { error?: string }).error || "Opzoeken mislukte."); return; }
      setInfo(d);
      if (d.found && d.balanceCents) setAmount((d.balanceCents / 100).toFixed(2));
    } catch {
      setErr("Kon de bon niet opzoeken.");
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    setErr(""); setMsg("");
    const cents = Math.round(parseFloat((amount || "").replace(",", ".")) * 100);
    if (!Number.isFinite(cents) || cents <= 0) { setErr("Vul een geldig bedrag in."); return; }
    if (info?.balanceCents != null && cents > info.balanceCents) { setErr("Bedrag is hoger dan het saldo."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/account/giftcard/redeem", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: info?.code || code, amountCents: cents }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) { setErr(d.error || "Verzilveren mislukte."); return; }
      setMsg(`${formatEuro(d.redeemedCents)} verzilverd. Nieuw saldo: ${formatEuro(d.newBalanceCents)}.`);
      setInfo((p) =>
        p
          ? {
              ...p,
              balanceCents: d.newBalanceCents,
              status: d.newBalanceCents <= 0 ? "depleted" : p.status,
              transactions: [{ deltaCents: -d.redeemedCents, reason: "redeem", orderNumber: "winkel", at: new Date().toISOString() }, ...(p.transactions || [])],
            }
          : p,
      );
      setAmount("");
    } catch {
      setErr("Verzilveren mislukte.");
    } finally {
      setBusy(false);
    }
  }

  const active = Boolean(info?.found) && info?.status !== "cancelled" && info?.status !== "pending" && (info?.balanceCents ?? 0) > 0;
  const expired = Boolean(info?.expiresAt && new Date(info.expiresAt as string).getTime() < Date.now());

  return (
    <div className="max-w-xl space-y-5">
      <p className="text-sm text-pslate">
        Verzilver een online of in de winkel gekochte GENTS-cadeaubon aan de balie. Tik de code in, controleer het saldo en boek het bedrag af.
      </p>

      <form onSubmit={lookup} className="rounded-xl border border-pnavy-100 bg-white p-5 shadow-portal">
        <label className="block text-sm font-medium text-pnavy">Cadeaubon-code</label>
        <div className="mt-2 flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="GIFT-XXXX-XXXX" className={`${FIELD} uppercase`} />
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "…" : "Opzoeken"}</button>
        </div>
      </form>

      {err ? <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">{err}</p> : null}
      {msg ? <p className="rounded-lg bg-green-50 px-4 py-2.5 text-sm text-green-700">{msg}</p> : null}

      {info && !info.found ? (
        <p className="text-sm text-pslate">Geen cadeaubon gevonden met code <strong className="text-pnavy">{info.code}</strong>.</p>
      ) : null}

      {info?.found ? (
        <div className="rounded-xl border border-pnavy-100 bg-white p-5 shadow-portal">
          <div className="flex items-baseline justify-between">
            <p className="font-mono text-sm text-pnavy">{info.code}</p>
            <span className="text-xs uppercase tracking-wide text-pslate">{info.status}</span>
          </div>
          <p className="mt-3 text-3xl font-semibold tabular-nums text-pnavy">{formatEuro(info.balanceCents ?? 0)}</p>
          <p className="text-xs text-pslate">
            saldo · oorspronkelijk {formatEuro(info.initialCents ?? 0)}
            {info.expiresAt ? ` · geldig t/m ${new Date(info.expiresAt).toLocaleDateString("nl-NL")}` : ""}
          </p>

          {!active || expired ? (
            <p className="mt-4 rounded-lg bg-pnavy-50 px-4 py-2.5 text-sm text-pslate">
              {expired ? "Deze bon is verlopen." : (info.balanceCents ?? 0) <= 0 ? "Deze bon is volledig gebruikt." : "Deze bon is niet actief."}
            </p>
          ) : (
            <div className="mt-4 border-t border-pnavy-100 pt-4">
              <label className="block text-sm font-medium text-pnavy">Te verzilveren bedrag</label>
              <div className="mt-2 flex flex-wrap gap-2">
                <div className="relative min-w-[8rem] flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-pslate">€</span>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={`${FIELD} pl-7`} />
                </div>
                <button type="button" onClick={() => setAmount(((info.balanceCents ?? 0) / 100).toFixed(2))} className={btnSecondary}>Heel saldo</button>
                <button type="button" onClick={redeem} disabled={busy} className={btnPrimary}>{busy ? "…" : "Verzilveren"}</button>
              </div>
            </div>
          )}

          {info.transactions && info.transactions.length ? (
            <div className="mt-5 border-t border-pnavy-100 pt-4">
              <p className="mb-2 text-xs uppercase tracking-wide text-pslate">Recente transacties</p>
              <ul className="space-y-1.5">
                {info.transactions.map((t, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-pslate">
                      {REASON_LABEL[t.reason] || t.reason}
                      {t.orderNumber ? ` · ${t.orderNumber}` : ""}
                      {t.at ? ` · ${new Date(t.at).toLocaleDateString("nl-NL")}` : ""}
                    </span>
                    <span className={`shrink-0 tabular-nums ${t.deltaCents < 0 ? "text-pnavy" : "text-green-700"}`}>
                      {t.deltaCents < 0 ? "−" : "+"}{formatEuro(Math.abs(t.deltaCents))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
