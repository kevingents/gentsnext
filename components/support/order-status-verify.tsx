"use client";

import { useState } from "react";
import { useT } from "@/components/i18n/locale-provider";

/**
 * Inline orderstatus-opzoek voor de support-widget (gast-pad): ordernummer +
 * postcode → /api/support/order-status → de echte status als bericht in de
 * chat. Hufterproof: twee velden en een knop, geen vrije chat-verificatie.
 * Niet gevonden? Dan de standaard vervolgstap: e-mail achterlaten → een
 * collega zoekt het uit (bestaande escalatie via /api/support).
 */

type OrderStatusResult = {
  orderNumber: string;
  orderedAt: string;
  status: string;
  statusText: string;
  trackTraceUrl: string;
  return: { status: string; statusText: string } | null;
  refund: { amountCents: number; statusText: string } | null;
};

function fmtDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return "";
  }
}

export function OrderStatusVerify({ defaultEmail = "" }: { defaultEmail?: string }) {
  const t = useT();
  const [orderNr, setOrderNr] = useState("");
  const [postcode, setPostcode] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<OrderStatusResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [escalEmail, setEscalEmail] = useState(defaultEmail);
  const [escalBusy, setEscalBusy] = useState(false);
  const [escalDone, setEscalDone] = useState(false);

  // Geen <form>-elementen hier: de component wordt óók binnen de servicepagina-
  // form gerenderd en geneste forms zijn ongeldige HTML (de submit zou het
  // buitenste formulier triggeren). Enter werkt via onKeyDown op de velden.
  async function lookup() {
    if (!orderNr.trim() || !postcode.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResults(null);
    setEscalDone(false);
    try {
      const r = await fetch("/api/support/order-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNr: orderNr.trim(), postcode: postcode.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.ok && Array.isArray(d.orders) && d.orders.length) {
        setResults(d.orders as OrderStatusResult[]);
      } else {
        setError(String(d?.error || t("help.order.notFound")));
      }
    } catch {
      setError(t("help.errorCall"));
    } finally {
      setBusy(false);
    }
  }

  async function escalate() {
    if (!escalEmail.trim() || escalBusy) return;
    setEscalBusy(true);
    try {
      const r = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: `Klant zoekt de status van een bestelling, maar de combinatie ordernummer + postcode werd niet gevonden (opgegeven ordernummer: ${orderNr.trim() || "onbekend"}).`,
          email: escalEmail,
          forceEscalate: true,
        }),
      });
      const d = await r.json().catch(() => ({}));
      setEscalDone(Boolean(d?.escalated));
    } catch {
      /* knop blijft staan voor een nieuwe poging */
    } finally {
      setEscalBusy(false);
    }
  }

  return (
    <div className="mt-3 border border-line bg-surface p-3">
      <p className="flex items-center gap-2 font-sans text-xs font-medium text-ink">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden className="shrink-0">
          <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" strokeLinejoin="round" />
          <path d="M3 8l9 5 9-5M12 13v8" strokeLinejoin="round" />
        </svg>
        {t("help.order.title")}
      </p>
      <p className="mt-1 font-sans text-xs text-ink-soft">{t("help.order.intro")}</p>

      <div className="mt-2 flex flex-col gap-2">
        <input
          type="text"
          value={orderNr}
          onChange={(e) => setOrderNr(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookup(); } }}
          placeholder={t("help.order.nrPlaceholder")}
          autoComplete="off"
          className="w-full border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none"
        />
        <input
          type="text"
          value={postcode}
          onChange={(e) => setPostcode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookup(); } }}
          placeholder={t("help.order.pcPlaceholder")}
          autoComplete="postal-code"
          className="w-full border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none"
        />
        <button type="button" onClick={() => void lookup()} disabled={busy || !orderNr.trim() || !postcode.trim()} className="btn-primary w-full !py-2 text-sm">
          {busy ? t("help.order.searching") : t("help.order.submit")}
        </button>
      </div>

      {results ? (
        <ul className="mt-3 flex flex-col gap-2">
          {results.map((o) => (
            <li key={o.orderNumber} className="border border-line bg-canvas p-3">
              <p className="font-sans text-xs font-medium text-ink">
                {o.orderNumber}
                {o.orderedAt ? <span className="font-normal text-muted"> — {t("help.order.orderedOn", { date: fmtDate(o.orderedAt) })}</span> : null}
              </p>
              <p className="mt-1 font-sans text-sm text-ink-soft">{o.statusText}</p>
              {o.return ? (
                <p className="mt-1 font-sans text-xs text-ink-soft">
                  <span className="font-medium text-ink">{t("help.order.return")}:</span> {o.return.statusText}
                </p>
              ) : null}
              {o.refund ? (
                <p className="mt-1 font-sans text-xs text-ink-soft">
                  <span className="font-medium text-ink">{t("help.order.refund")}:</span> {o.refund.statusText}
                </p>
              ) : null}
              {o.trackTraceUrl ? (
                <a href={o.trackTraceUrl} className="mt-2 inline-flex items-center gap-1.5 font-sans text-xs text-ink underline hover:no-underline">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden className="shrink-0">
                    <path d="M7 17L17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {t("help.order.track")}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="font-sans text-sm text-ink-soft">{error}</p>
          {escalDone ? (
            <p className="mt-2 font-sans text-xs text-muted">{t("help.order.escalated")}</p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              <p className="font-sans text-xs text-muted">{t("help.order.escalateIntro")}</p>
              <input
                type="email"
                value={escalEmail}
                onChange={(e) => setEscalEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void escalate(); } }}
                placeholder={t("help.emailPlaceholder")}
                autoComplete="email"
                className="w-full border border-line bg-canvas px-3 py-2 font-sans text-xs focus:border-ink focus:outline-none"
              />
              <button type="button" onClick={() => void escalate()} disabled={escalBusy || !escalEmail.trim()} className="btn-primary w-full !py-2 text-sm">
                {escalBusy ? t("help.thinking") : t("help.order.escalateCta")}
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
