"use client";

import { useState } from "react";

/**
 * Light-touch nieuwsbrief-aanmelding. POST'et naar /api/newsletter — die
 * route is een no-op stub tot Brevo/Resend Audience aangesloten wordt
 * (env-gated). Front-end is alvast af.
 */
export function NewsletterSignup() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
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
      const r = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (r.ok) {
        setState("done");
        setMsg("Bedankt — kijk in je inbox voor een bevestiging.");
      } else {
        setState("fail");
        setMsg("Er ging iets mis. Probeer het later opnieuw.");
      }
    } catch {
      setState("fail");
      setMsg("Er ging iets mis. Probeer het later opnieuw.");
    }
  }

  if (state === "done") {
    return <p className="font-sans text-sm text-canvas/80">{msg}</p>;
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2 sm:flex-row">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Je e-mailadres"
        aria-label="E-mailadres"
        className="w-full border border-canvas/30 bg-transparent px-3 py-2.5 font-sans text-sm text-canvas placeholder:text-canvas/50 focus:border-canvas focus:outline-none"
      />
      <button
        type="submit"
        disabled={state === "busy"}
        className="inline-flex items-center justify-center border border-canvas bg-canvas px-5 py-2.5 font-sans text-sm font-medium text-ink transition-colors hover:bg-surface disabled:opacity-50"
      >
        {state === "busy" ? "Bezig…" : "Inschrijven"}
      </button>
      {msg && state !== "busy" ? <span role="alert" className="font-sans text-xs text-canvas/70 sm:hidden">{msg}</span> : null}
    </form>
  );
}
