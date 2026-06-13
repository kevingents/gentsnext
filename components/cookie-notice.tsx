"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const KEY = "gents-cookie-v1";

/**
 * Light-touch cookie-melding (essentiële cookies + functionele opslag). Bij de
 * cutover/EAA-compliance-check moet dit een echte CMP worden (Cookiebot/
 * CookieFirst) met categorieën en Google Consent Mode v2. Voor nu: één klik
 * weg, keuze in localStorage.
 */
export function CookieNotice() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setVisible(true);
    } catch {
      /* leeg */
    }
  }, []);
  function dismiss() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* leeg */
    }
    setVisible(false);
  }
  if (!visible) return null;
  return (
    <div
      role="dialog"
      aria-label="Cookie-melding"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-2xl border border-line bg-canvas p-4 shadow-pop sm:p-5"
    >
      <p className="font-sans text-sm text-ink-soft">
        We gebruiken cookies om de site te laten werken en je voorkeuren te
        bewaren. Voor meer informatie zie onze{" "}
        <Link href="/pages/cookies" className="text-ink underline underline-offset-4">
          cookieverklaring
        </Link>
        .
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={dismiss} className="btn-primary !px-5 !py-2 text-xs">
          Akkoord
        </button>
        <Link href="/pages/cookies" className="btn-ghost !px-5 !py-2 text-xs">
          Meer informatie
        </Link>
      </div>
    </div>
  );
}
