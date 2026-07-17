"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/i18n/locale-provider";
import { OrderStatusVerify } from "@/components/support/order-status-verify";

/**
 * Hulp-widget rechtsonder met een AI-assistent: geeft direct antwoord op basis
 * van de kennisbank (en voor ingelogde klanten: hun echte orderstatus), of
 * escaleert naar een medewerker (via /api/support). Bij een orderstatus-vraag
 * van een gast verschijnt een klein verificatieformulier (ordernummer +
 * postcode). Daaronder snelle links naar service/maatadvies/winkels.
 */
export function HelpButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
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
    setNeedsVerify(false);
    try {
      const r = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, email }),
      });
      const d = await r.json();
      setAnswer(d.answer || "");
      setEscalated(Boolean(d.escalated));
      setNeedsVerify(Boolean(d.needsOrderVerification));
    } catch {
      setAnswer(t("help.errorCall"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-20 right-4 z-30 flex flex-col items-end lg:bottom-6 lg:right-6">
      {open ? (
        <div className="mb-3 max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto border border-line bg-canvas p-4 shadow-pop">
          <p className="label-brand mb-2">{t("help.title")}</p>
          <form onSubmit={ask}>
            <textarea
              value={q}
              onChange={(e) => setQ(e.target.value)}
              rows={2}
              placeholder={t("help.placeholder")}
              className="w-full resize-none border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("help.emailPlaceholder")}
              className="mt-2 w-full border border-line bg-canvas px-3 py-2 font-sans text-xs focus:border-ink focus:outline-none"
            />
            <button type="submit" disabled={busy} className="btn-primary mt-2 w-full !py-2 text-sm">
              {busy ? t("help.thinking") : t("help.ask")}
            </button>
          </form>

          {answer ? (
            <div className="mt-3 border-t border-line pt-3">
              <p className="font-sans text-sm text-ink-soft">{answer}</p>
              {escalated ? <p className="mt-1 font-sans text-xs text-muted">{t("help.escalated")}</p> : null}
            </div>
          ) : null}

          {needsVerify ? <OrderStatusVerify defaultEmail={email} /> : null}

          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 font-sans text-xs">
            <li><Link href="/pages/service" onClick={() => setOpen(false)} className="text-ink hover:underline">{t("help.link.service")}</Link></li>
            <li><Link href="/maatadvies" onClick={() => setOpen(false)} className="text-ink hover:underline">{t("help.link.sizeAdvice")}</Link></li>
            <li><Link href="/pages/winkels" onClick={() => setOpen(false)} className="text-ink hover:underline">{t("help.link.stores")}</Link></li>
          </ul>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("help.title")}
        className="flex h-12 w-12 items-center justify-center gap-2 rounded-full border border-line bg-canvas font-sans text-sm shadow-card hover:border-ink sm:w-auto sm:px-5"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden className="shrink-0">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 014.9.5c0 1.5-2.4 2-2.4 3.5M12 16h.01" strokeLinecap="round" />
        </svg>
        <span className="hidden sm:inline">{t("help.title")}</span>
      </button>
    </div>
  );
}
