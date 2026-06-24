"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readConsent, writeConsent, OPEN_CONSENT_EVENT, type Consent } from "@/lib/consent";
import { useT } from "@/components/i18n/locale-provider";

/**
 * Cookie-consent (AVG-conform): gelijkwaardige knoppen 'Alleen noodzakelijk' en
 * 'Alles accepteren', plus granulaire voorkeuren (analytisch/marketing, geen
 * pre-tick). Keuze is altijd te wijzigen via 'Cookie-instellingen' in de footer.
 * Tracking gebeurt pas ná opt-in (zie lib/track-client + lib/consent).
 */
export function CookieNotice() {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [details, setDetails] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    if (!readConsent()) setVisible(true);
    const open = () => {
      const c = readConsent();
      setAnalytics(c?.analytics ?? false);
      setMarketing(c?.marketing ?? false);
      setDetails(true);
      setVisible(true);
    };
    window.addEventListener(OPEN_CONSENT_EVENT, open);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, open);
  }, []);

  function save(c: Consent) {
    writeConsent(c);
    setVisible(false);
    setDetails(false);
  }

  if (!visible) return null;
  return (
    <div role="dialog" aria-label="Cookievoorkeuren" className="fixed inset-x-3 bottom-3 z-[55] mx-auto max-w-2xl rounded-card border border-line bg-canvas p-4 shadow-pop sm:p-5">
      <p className="font-display text-base">{t("cookies.title")}</p>
      <p className="mt-1 font-sans text-sm text-ink-soft">
        Functionele cookies hebben we nodig om de site te laten werken. Voor anonieme statistieken en
        gepersonaliseerde aanbiedingen vragen we eerst je toestemming. Meer in onze{" "}
        <Link href="/pages/cookies" className="text-ink underline underline-offset-4">cookieverklaring</Link>.
      </p>

      {details ? (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <Row label={t("cookies.necessary")} desc={t("cookies.necessary.desc")} checked disabled />
          <Row label={t("cookies.analytics")} desc="Anonieme statistieken om de winkel te verbeteren." checked={analytics} onChange={setAnalytics} />
          <Row label={t("cookies.marketing")} desc="Relevante aanbiedingen en gepersonaliseerde content." checked={marketing} onChange={setMarketing} />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => save({ analytics: false, marketing: false })} className="btn-ghost !px-5 !py-2 text-xs">
          {t("cookies.essentialOnly")}
        </button>
        {details ? (
          <button type="button" onClick={() => save({ analytics, marketing })} className="btn-ghost !px-5 !py-2 text-xs">{t("cookies.save")}</button>
        ) : (
          <button type="button" onClick={() => setDetails(true)} className="btn-ghost !px-5 !py-2 text-xs">{t("cookies.preferences")}</button>
        )}
        <button type="button" onClick={() => save({ analytics: true, marketing: true })} className="btn-primary !px-5 !py-2 text-xs">
          {t("cookies.acceptAll")}
        </button>
      </div>
    </div>
  );
}

function Row({ label, desc, checked, disabled, onChange }: { label: string; desc: string; checked: boolean; disabled?: boolean; onChange?: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} className="mt-0.5 h-4 w-4 accent-ink disabled:opacity-50" />
      <span>
        <span className="block font-sans text-sm font-medium text-ink">{label}</span>
        <span className="block font-sans text-xs text-muted">{desc}</span>
      </span>
    </label>
  );
}
