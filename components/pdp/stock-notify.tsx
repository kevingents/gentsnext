"use client";

import { useState } from "react";
import { CheckIcon } from "@/components/icons";
import { useT } from "@/components/i18n/locale-provider";

type Props = {
  productHandle: string;
  productTitle: string;
  sku?: string;
  size?: string;
  color?: string;
  /** "compact" onder een uitverkochte maat, "block" als hele product op is. */
  variant?: "compact" | "block";
};

type Channel = "email" | "whatsapp";

/** "Mail me / WhatsApp me als het er weer is" — terug-op-voorraad-notificatie. */
export function StockNotify({ productHandle, productTitle, sku, size, color, variant = "compact" }: Props) {
  const t = useT();
  const [open, setOpen] = useState(variant === "block");
  const [channel, setChannel] = useState<Channel>("email");
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const valid = channel === "email" ? /.+@.+\..+/.test(value) : value.replace(/[\s().+-]/g, "").length >= 8;
    if (!valid) {
      setErr(channel === "email" ? t("pdp.stocknotify.invalidemail") : t("pdp.stocknotify.invalidphone"));
      setState("fail");
      return;
    }
    setState("busy");
    setErr("");
    try {
      const r = await fetch("/api/stock-notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          email: channel === "email" ? value : "",
          phone: channel === "whatsapp" ? value : "",
          productHandle,
          productTitle,
          sku,
          size,
          color,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setState("done");
      else {
        setState("fail");
        setErr(d.error || t("common.error"));
      }
    } catch {
      setState("fail");
      setErr("Er ging iets mis. Probeer het later opnieuw.");
    }
  }

  if (state === "done") {
    return (
      <p className="mt-3 border border-line bg-surface px-4 py-3 font-sans text-sm text-ink-soft">
        <CheckIcon className="inline-block h-3.5 w-3.5 align-[-2px] text-success" /> Gelukt — we sturen je een {channel === "whatsapp" ? "WhatsApp" : "mail"}
        {size ? ` zodra maat ${size}` : " zodra dit product"} weer op voorraad is.
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
        Houd me op de hoogte {size ? `(maat ${size})` : ""}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className={variant === "block" ? "mt-4 border border-line p-4" : "mt-3"}>
      {variant === "block" ? (
        <p className="mb-3 font-sans text-sm">
          <span className="font-medium">{t("pdp.stocknotify.soldout")}</span>{" "}
          <span className="text-muted">{t("pdp.stocknotify.description")}</span>
        </p>
      ) : null}

      {/* Kanaalkeuze */}
      <div className="mb-2 inline-flex overflow-hidden rounded-card border border-line text-sm">
        <button
          type="button"
          onClick={() => { setChannel("email"); setValue(""); setState("idle"); }}
          className={`px-3 py-1.5 font-sans transition-colors ${channel === "email" ? "bg-ink text-canvas" : "text-ink-soft hover:text-ink"}`}
        >
          {t("pdp.stocknotify.email")}
        </button>
        <button
          type="button"
          onClick={() => { setChannel("whatsapp"); setValue(""); setState("idle"); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 font-sans transition-colors ${channel === "whatsapp" ? "bg-ink text-canvas" : "text-ink-soft hover:text-ink"}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M17.5 14.4l-2.5-1.3-.6.7c-.6.7-1.4.8-2.3.3-1.5-.8-3-2.2-3.8-3.7-.5-.9-.3-1.7.3-2.3l.7-.7-1.2-2.5c-.2-.4-.6-.6-1-.4-.8.3-1.6 1-2 1.7-.7 1.2-.4 3 1 5.6 1.4 2.6 4.3 5.5 6.9 6.9 2.6 1.4 4.4 1.7 5.6 1 .7-.4 1.3-1.2 1.7-2 .1-.4-.1-.8-.5-1zM12 2C6.5 2 2 6.5 2 12c0 1.9.5 3.7 1.4 5.2L2 22l4.9-1.3C8.4 21.5 10.1 22 12 22c5.5 0 10-4.5 10-10S17.5 2 12 2z" />
          </svg>
          {t("pdp.stocknotify.whatsapp")}
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type={channel === "email" ? "email" : "tel"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={channel === "email" ? t("pdp.stocknotify.emailplaceholder") : t("pdp.stocknotify.phoneplaceholder")}
          aria-label={channel === "email" ? "E-mailadres" : "Telefoonnummer"}
          className="w-full border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none"
        />
        <button type="submit" disabled={state === "busy"} className="btn-primary !px-4 !py-2 whitespace-nowrap">
          {state === "busy" ? "…" : t("pdp.stocknotify.submit")}
        </button>
      </div>
      {state === "fail" ? <p className="mt-2 font-sans text-xs text-danger">{err}</p> : null}
    </form>
  );
}
