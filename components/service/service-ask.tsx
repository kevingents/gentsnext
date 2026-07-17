"use client";

import { useState } from "react";
import { useT } from "@/components/i18n/locale-provider";
import { OrderStatusVerify } from "@/components/support/order-status-verify";

/**
 * Directe AI-vraag op de servicepagina: geeft meteen antwoord uit de kennisbank
 * (en voor ingelogde klanten: hun echte orderstatus), of escaleert naar een
 * medewerker (via /api/support) met e-mailterugkoppeling. Bij een
 * orderstatus-vraag van een gast verschijnt het verificatieformulier.
 */
export function ServiceAsk() {
  const t = useT();
  const [q, setQ] = useState("");
  const [email, setEmail] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [escalated, setEscalated] = useState(false);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [busy, setBusy] = useState(false);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setAnswer(null);
    setEscalated(false);
    setNeedsVerify(false);
    try {
      const r = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, email }),
      });
      const d = await r.json();
      setAnswer(d.answer || "We hebben je vraag ontvangen.");
      setEscalated(Boolean(d.escalated));
      setNeedsVerify(Boolean(d.needsOrderVerification));
    } catch {
      setAnswer("Er ging iets mis. Mail ons gerust rechtstreeks.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={ask} className="rounded-card border border-line bg-canvas p-5 shadow-pop">
      <p className="font-display text-lg">Direct antwoord op je vraag</p>
      <p className="mt-1 font-sans text-sm text-ink-soft">
        Onze assistent helpt je meteen op weg — komt 'ie er niet uit, dan zetten we je vraag door naar een collega.
      </p>
      <textarea
        value={q}
        onChange={(e) => setQ(e.target.value)}
        rows={3}
        placeholder="Bijv. Hoe retourneer ik een artikel? Welke maat heb ik nodig?"
        className="mt-4 w-full resize-y border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
      />
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Je e-mail (voor een persoonlijk antwoord)"
          className="flex-1 border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
        />
        <button type="submit" disabled={busy || !q.trim()} className="btn-primary sm:w-auto">
          {busy ? t("common.processing") : "Stel je vraag"}
        </button>
      </div>
      {answer ? (
        <div className="mt-4 rounded-card bg-surface p-4">
          <p className="font-sans text-sm leading-relaxed text-ink">{answer}</p>
          {escalated ? (
            <p className="mt-2 font-sans text-xs text-muted">We hebben je vraag doorgezet — je hoort snel van ons.</p>
          ) : null}
        </div>
      ) : null}

      {needsVerify ? <OrderStatusVerify defaultEmail={email} /> : null}
    </form>
  );
}
