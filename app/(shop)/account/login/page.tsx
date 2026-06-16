"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

const USPS = [
  "Volg je bestellingen, van order tot bezorging",
  "Bewaar je maten en stijlvoorkeuren",
  "Reken sneller af — zonder wachtwoord",
  "Je spaarpunten en tegoed op één plek",
];

function GoldCheck() {
  return (
    <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-gold" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M5 12l5 5 9-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "fail">("idle");
  const [devLink, setDevLink] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/.+@.+\..+/.test(email)) {
      setMsg("Vul een geldig e-mailadres in.");
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
        setMsg(d.sent ? "Check je inbox — we hebben je een login-link gestuurd." : "Login-link aangemaakt.");
      } else {
        setState("fail");
        setMsg(d.error || "Er ging iets mis.");
      }
    } catch {
      setState("fail");
      setMsg("Er ging iets mis. Probeer het later opnieuw.");
    }
  }

  return (
    <div className="grid min-h-[80vh] lg:grid-cols-2">
      {/* Merkpaneel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink px-12 py-14 text-canvas lg:flex">
        {/* Echte merkfoto als sfeer (geen AI), met donkere overlay voor leesbaarheid. */}
        <Image src="/brand/brand-impression-gala.jpg" alt="" fill priority sizes="50vw" className="object-cover opacity-25" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-ink/90 via-ink/70 to-ink/90" />
        <div className="relative">
          <Image src="/brand/brand-logo-wit.png" alt="GENTS — Suits You" width={512} height={244} priority className="h-12 w-auto" />
        </div>
        <div className="relative">
          <h2 className="font-display text-display-md leading-tight text-canvas">Welkom in<br />jouw GENTS.</h2>
          <p className="mt-3 max-w-sm font-sans text-sm text-canvas/65">Eén account, overal thuis — online én in onze 19 winkels.</p>
          <ul className="mt-8 space-y-3.5">
            {USPS.map((u) => (
              <li key={u} className="flex items-start gap-3 font-sans text-sm text-canvas/85">
                <GoldCheck />
                {u}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative font-sans text-xs uppercase tracking-wider text-canvas/35">Herenmode met karakter</p>
      </div>

      {/* Formulier */}
      <div className="flex items-center justify-center bg-canvas px-gutter py-16">
        <div className="w-full max-w-sm">
          {/* Mobiel merk-kopje */}
          <div className="mb-8 lg:hidden">
            <Image src="/brand/brand-logo-zwart.png" alt="GENTS — Suits You" width={512} height={244} className="h-10 w-auto" />
          </div>

          <p className="label-brand">Mijn GENTS</p>
          <h1 className="mt-2 text-display-md">Inloggen of registreren</h1>
          <p className="mt-3 font-sans text-sm text-ink-soft">
            Vul je e-mailadres in. Je ontvangt een veilige login-link — geen wachtwoord nodig. Nieuw? Dan maken we direct een account voor je aan.
          </p>

          {state === "sent" ? (
            <div className="mt-8 border-l-2 border-gold bg-surface p-6">
              <p className="font-display text-lg font-light">{msg}</p>
              <p className="mt-2 font-sans text-xs text-muted">Geen mail ontvangen? Kijk in je spam of probeer het zo opnieuw.</p>
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
                <span className="font-sans text-sm">E-mailadres</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jij@voorbeeld.nl"
                  className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
                />
              </label>
              {msg && state === "fail" ? <p className="font-sans text-sm text-danger">{msg}</p> : null}
              <button type="submit" disabled={state === "busy"} className="btn-primary w-full">
                {state === "busy" ? "Bezig…" : "Stuur login-link"}
              </button>
            </form>
          )}

          <p className="mt-6 font-sans text-xs text-muted">
            Door in te loggen ga je akkoord met onze{" "}
            <Link href="/pages/algemene-voorwaarden" className="underline">voorwaarden</Link> en{" "}
            <Link href="/pages/privacyverklaring" className="underline">privacyverklaring</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
