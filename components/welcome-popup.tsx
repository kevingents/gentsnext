"use client";

import { useEffect, useState } from "react";

const KEY = "gents-welcome-v1";

/**
 * Welkomstkorting-popup: 10% op de eerste bestelling in ruil voor inschrijven.
 * Verschijnt één keer per bezoeker, na een korte vertraging of bij exit-intent.
 * Maakt een echte, verzilverbare kortingscode aan (/api/welcome-discount).
 */
export function WelcomePopup() {
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY)) return;
    } catch {
      return;
    }
    let done = false;
    const open = () => {
      if (done) return;
      done = true;
      setShow(true);
    };
    const t = setTimeout(open, 18000); // na 18s
    const onLeave = (e: MouseEvent) => {
      if (e.clientY <= 0) open(); // exit-intent (muis naar boven uit beeld)
    };
    document.addEventListener("mouseleave", onLeave);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  function close() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* leeg */
    }
    setShow(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/.+@.+\..+/.test(email)) {
      setErr("Vul een geldig e-mailadres in.");
      setState("fail");
      return;
    }
    setState("busy");
    try {
      const r = await fetch("/api/welcome-discount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = await r.json();
      if (d.ok) {
        setCode(d.code);
        setState("done");
        try {
          localStorage.setItem(KEY, "1");
        } catch {
          /* leeg */
        }
      } else {
        setErr(d.error || "Er ging iets mis.");
        setState("fail");
      }
    } catch {
      setErr("Er ging iets mis.");
      setState("fail");
    }
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Welkomstkorting">
      <div className="absolute inset-0 bg-ink/50" onClick={close} />
      <div className="relative w-full max-w-md overflow-hidden border border-line bg-canvas shadow-pop">
        <button type="button" onClick={close} aria-label="Sluiten" className="absolute right-3 top-3 z-10 text-muted hover:text-ink">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
        <div className="bg-ink px-8 py-8 text-center text-canvas">
          <p className="label-brand !text-canvas/70">Welkom bij GENTS</p>
          <p className="mt-2 font-display text-4xl font-light">10% korting</p>
          <p className="mt-1 font-sans text-sm text-canvas/80">op je eerste bestelling</p>
        </div>
        <div className="px-8 py-6">
          {state === "done" ? (
            <div className="text-center">
              <p className="font-sans text-sm text-ink-soft">Je code:</p>
              <p className="my-2 inline-block bg-surface px-4 py-2 font-display text-xl tracking-widest">{code}</p>
              <p className="font-sans text-xs text-muted">Plak de code in je winkelwagen bij het afrekenen. 30 dagen geldig.</p>
              <button type="button" onClick={close} className="btn-primary mt-5 w-full">Verder shoppen</button>
            </div>
          ) : (
            <form onSubmit={submit}>
              <p className="text-center font-sans text-sm text-ink-soft">
                Schrijf je in voor onze nieuwsbrief en ontvang direct je kortingscode.
              </p>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Je e-mailadres"
                className="mt-4 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
              />
              {err ? <p className="mt-1 font-sans text-xs text-danger">{err}</p> : null}
              <button type="submit" disabled={state === "busy"} className="btn-primary mt-3 w-full">
                {state === "busy" ? "Bezig…" : "Geef mij 10% korting"}
              </button>
              <button type="button" onClick={close} className="mt-2 w-full font-sans text-xs text-muted underline">
                Nee bedankt
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
