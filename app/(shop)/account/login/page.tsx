"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { VISUAL } from "@/lib/visuals";
import { useT } from "@/components/i18n/locale-provider";

const USPS = [
  "login.usp.orders",
  "login.usp.sizes",
  "login.usp.checkout",
  "login.usp.loyalty",
];

function GoldCheck() {
  return (
    <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-gold" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M5 12l5 5 9-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function LoginPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "fail">("idle");
  const [devLink, setDevLink] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/.+@.+\..+/.test(email)) {
      setMsg(t("common.error.emailInvalid"));
      setState("fail");
      return;
    }
    setState("busy");
    try {
      const r = await fetch("/api/account/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = await r.json();
      if (d.ok) {
        setState("sent");
        setDevLink(d.devLink || null);
        setMsg(d.sent ? t("login.sentInbox") : t("login.linkCreated"));
      } else {
        setState("fail");
        setMsg(d.error || t("common.error"));
      }
    } catch {
      setState("fail");
      setMsg(t("forms.error.tryLater"));
    }
  }

  return (
    <div className="grid min-h-[80vh] lg:grid-cols-2">
      {/* Merkpaneel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink px-12 py-14 text-canvas lg:flex">
        {/* Echte merkfoto als sfeer (geen AI), met donkere overlay voor leesbaarheid. */}
        <Image src={VISUAL.formal} alt="" fill priority sizes="50vw" className="object-cover opacity-25" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-ink/90 via-ink/70 to-ink/90" />
        <div className="relative">
          <Image src="/brand/brand-logo-wit.png" alt="GENTS — Suits You" width={512} height={244} priority className="h-12 w-auto" />
        </div>
        <div className="relative">
          <h2 className="font-display text-display-md leading-tight text-canvas">{t("login.welcomeTitle1")}<br />{t("login.welcomeTitle2")}</h2>
          <p className="mt-3 max-w-sm font-sans text-sm text-canvas/65">{t("login.welcomeSub")}</p>
          <ul className="mt-8 space-y-3.5">
            {USPS.map((u) => (
              <li key={u} className="flex items-start gap-3 font-sans text-sm text-canvas/85">
                <GoldCheck />
                {t(u)}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative font-sans text-xs uppercase tracking-wider text-canvas/35">{t("login.tagline")}</p>
      </div>

      {/* Formulier */}
      <div className="flex items-center justify-center bg-canvas px-gutter py-16">
        <div className="w-full max-w-sm">
          {/* Mobiel merk-kopje */}
          <div className="mb-8 lg:hidden">
            <Image src="/brand/brand-logo-zwart.png" alt="GENTS — Suits You" width={512} height={244} className="h-10 w-auto" />
          </div>

          <p className="label-brand">{t("login.eyebrow")}</p>
          <h1 className="mt-2 text-display-md">{t("login.title")}</h1>
          <p className="mt-3 font-sans text-sm text-ink-soft">
            {t("login.intro")}
          </p>

          {state === "sent" ? (
            <div className="mt-8 border-l-2 border-gold bg-surface p-6">
              <p className="font-display text-lg font-light">{msg}</p>
              <p className="mt-2 font-sans text-xs text-muted">{t("login.noMailHint")}</p>
              {devLink ? (
                <p className="mt-4 font-sans text-sm">
                  <span className="text-muted">Dev-modus (geen e-mail gekoppeld) — </span>
                  <a href={devLink} className="text-ink underline underline-offset-4">klik hier om in te loggen</a>
                </p>
              ) : null}
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="mt-8 space-y-4">
              <label className="block">
                <span className="font-sans text-sm">{t("checkout.email")}</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("login.emailPlaceholder")}
                  className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
                />
              </label>
              {msg && state === "fail" ? <p className="font-sans text-sm text-danger">{msg}</p> : null}
              <button type="submit" disabled={state === "busy"} className="btn-primary w-full">
                {state === "busy" ? t("common.processing") : t("login.submit")}
              </button>
            </form>
          )}

          <p className="mt-6 font-sans text-xs text-muted">
            {t("login.terms.prefix")}{" "}
            <Link href="/pages/algemene-voorwaarden" className="underline">{t("login.terms.terms")}</Link> {t("login.terms.and")}{" "}
            <Link href="/pages/privacyverklaring" className="underline">{t("login.terms.privacy")}</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
