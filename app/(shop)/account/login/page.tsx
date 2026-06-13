"use client";

import Link from "next/link";
import { useState } from "react";

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
    <div className="mx-auto max-w-md px-gutter py-16">
      <p className="label-brand">Mijn GENTS</p>
      <h1 className="mt-2 text-display-md">Inloggen of registreren</h1>
      <p className="mt-3 font-sans text-sm text-ink-soft">
        Vul je e-mailadres in. Je ontvangt een veilige login-link — geen
        wachtwoord nodig. Nieuw? Dan maken we direct een account voor je aan.
      </p>

      {state === "sent" ? (
        <div className="mt-8 border border-line bg-surface p-6">
          <p className="font-display text-lg font-light">{msg}</p>
          {devLink ? (
            <p className="mt-4 font-sans text-sm">
              <span className="text-muted">Dev-modus (geen e-mail gekoppeld) — </span>
              <a href={devLink} className="text-ink underline underline-offset-4">
                klik hier om in te loggen
              </a>
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
  );
}
