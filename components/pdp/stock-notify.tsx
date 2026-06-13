"use client";

import { useState } from "react";

type Props = {
  productHandle: string;
  productTitle: string;
  sku?: string;
  size?: string;
  color?: string;
  /** "compact" onder een uitverkochte maat, "block" als hele product op is. */
  variant?: "compact" | "block";
};

/** "Mail me als het er weer is" — terug-op-voorraad-notificatie. */
export function StockNotify({ productHandle, productTitle, sku, size, color, variant = "compact" }: Props) {
  const [open, setOpen] = useState(variant === "block");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/.+@.+\..+/.test(email)) {
      setState("fail");
      return;
    }
    setState("busy");
    try {
      const r = await fetch("/api/stock-notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, productHandle, productTitle, sku, size, color }),
      });
      setState(r.ok ? "done" : "fail");
    } catch {
      setState("fail");
    }
  }

  if (state === "done") {
    return (
      <p className="mt-3 border border-line bg-surface px-4 py-3 font-sans text-sm text-ink-soft">
        ✓ Gelukt — we mailen je{size ? ` zodra maat ${size}` : " zodra dit product"} weer op voorraad is.
      </p>
    );
  }

  if (variant === "compact" && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center gap-2 font-sans text-sm text-ink underline underline-offset-4"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <path d="M4 4h16v12H5.2L4 17.5V4z" strokeLinejoin="round" />
          <path d="M8 9h8M8 12h5" strokeLinecap="round" />
        </svg>
        Mail me als {size ? `maat ${size}` : "dit product"} er weer is
      </button>
    );
  }

  return (
    <form onSubmit={submit} className={variant === "block" ? "mt-4 border border-line p-4" : "mt-3"}>
      {variant === "block" ? (
        <p className="mb-2 font-sans text-sm">
          <span className="font-medium">Tijdelijk uitverkocht.</span>{" "}
          <span className="text-muted">Laat je e-mail achter — we tippen je zodra het er weer is.</span>
        </p>
      ) : null}
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Je e-mailadres"
          aria-label="E-mailadres voor voorraadmelding"
          className="w-full border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none"
        />
        <button type="submit" disabled={state === "busy"} className="btn-primary !px-4 !py-2 whitespace-nowrap">
          {state === "busy" ? "…" : "Houd me op de hoogte"}
        </button>
      </div>
      {state === "fail" ? <p className="mt-2 font-sans text-xs text-danger">Vul een geldig e-mailadres in.</p> : null}
    </form>
  );
}
