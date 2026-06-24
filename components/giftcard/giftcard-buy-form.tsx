"use client";

import { useState } from "react";
import { formatEuro } from "@/lib/pricing";
import { useT } from "@/components/i18n/locale-provider";

type Props = {
  presetCents: number[];
  minCents: number;
  maxCents: number;
  validityMonths: number;
  defaultBuyerEmail?: string;
};

export function GiftcardBuyForm({ presetCents, minCents, maxCents, validityMonths, defaultBuyerEmail = "" }: Props) {
  const t = useT();
  const presets = presetCents.length ? presetCents : [2500, 5000, 10000];
  const [amountCents, setAmountCents] = useState(presets[1] ?? presets[0]);
  const [custom, setCustom] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [senderName, setSenderName] = useState("");
  const [message, setMessage] = useState("");
  const [buyerEmail, setBuyerEmail] = useState(defaultBuyerEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const amountValid = amountCents >= minCents && amountCents <= maxCents;

  function pickPreset(c: number) {
    setAmountCents(c);
    setCustom("");
  }
  function setCustomEuros(v: string) {
    setCustom(v);
    const c = Math.round(parseFloat(v.replace(",", ".")) * 100);
    if (Number.isFinite(c)) setAmountCents(c);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!amountValid) {
      setError(`Kies een bedrag tussen ${formatEuro(minCents)} en ${formatEuro(maxCents)}.`);
      return;
    }
    if (!/.+@.+\..+/.test(recipientEmail)) {
      setError(t("giftcard.error.email"));
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/giftcard/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents, recipientName, recipientEmail, senderName, message, buyerEmail }),
      });
      const d = await r.json();
      if (!d.ok) {
        setError(d.error || t("common.error"));
        return;
      }
      if (d.configured && d.checkoutUrl) {
        window.location.href = d.checkoutUrl;
      } else {
        setNotice(d.message || "Je cadeaubon is genoteerd.");
      }
    } catch {
      setError("Kon de cadeaubon niet versturen. Probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  if (notice) {
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <p className="label-brand">Bedankt</p>
        <p className="mt-2 font-sans text-sm text-ink-soft">{notice}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-card border border-line p-6">
      <p className="label-brand">{t("giftcard.form.amountLabel")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {presets.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => pickPreset(c)}
            className={`border px-4 py-2 font-sans text-sm transition-colors ${
              !custom && amountCents === c ? "border-ink bg-ink text-canvas" : "border-line text-ink-soft hover:border-ink"
            }`}
          >
            {formatEuro(c)}
          </button>
        ))}
      </div>
      <label className="mt-3 block">
        <span className="font-sans text-sm text-ink">{t("giftcard.form.customAmount")}</span>
        <div className="mt-1.5 flex items-center border border-line bg-canvas focus-within:border-ink">
          <span className="pl-3 font-sans text-sm text-muted">€</span>
          <input
            inputMode="decimal"
            value={custom}
            onChange={(e) => setCustomEuros(e.target.value)}
            placeholder={`${(minCents / 100).toFixed(0)} – ${(maxCents / 100).toFixed(0)}`}
            className="w-full bg-transparent px-2 py-2.5 font-sans text-sm focus:outline-none"
          />
        </div>
      </label>

      <p className="label-brand mt-7">{t("giftcard.form.recipientLabel")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="font-sans text-sm text-ink">{t("giftcard.form.recipientName")} <span className="text-muted">{t("common.optional")}</span></span>
          <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} maxLength={80} className="mt-1.5 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
        </label>
        <label className="block">
          <span className="font-sans text-sm text-ink">{t("giftcard.form.recipientEmail")}</span>
          <input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} maxLength={160} required className="mt-1.5 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
        </label>
        <label className="block">
          <span className="font-sans text-sm text-ink">Van <span className="text-muted">{t("common.optional")}</span></span>
          <input value={senderName} onChange={(e) => setSenderName(e.target.value)} maxLength={80} className="mt-1.5 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
        </label>
        <label className="block">
          <span className="font-sans text-sm text-ink">{t("giftcard.form.buyerEmail")} <span className="text-muted">{t("common.optional")}</span></span>
          <input type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} maxLength={160} className="mt-1.5 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="font-sans text-sm text-ink">{t("giftcard.form.message")} <span className="text-muted">{t("common.optional")}</span></span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={500} placeholder="Een paar woorden voor de ontvanger…" className="mt-1.5 w-full resize-none border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
      </label>

      {error ? <p role="alert" className="mt-4 font-sans text-sm text-danger">{error}</p> : null}

      <button type="submit" disabled={busy || !amountValid} className="btn-primary mt-6 w-full">
        {busy ? t("common.processing") : `Cadeaubon kopen — ${formatEuro(amountCents)}`}
      </button>
      <p className="mt-3 font-sans text-xs text-muted">
        De ontvanger krijgt de cadeaubon direct per e-mail na betaling. Geldig {validityMonths} maanden, in meerdere keren te besteden.
      </p>
    </form>
  );
}
