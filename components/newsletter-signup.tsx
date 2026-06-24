"use client";

import { useState } from "react";
import { useT } from "@/components/i18n/locale-provider";

/**
 * Nieuwsbrief-aanmelding met kanaalkeuze: per e-mail óf per WhatsApp.
 * POST'et naar /api/newsletter (eigen store + Resend voor e-mail).
 */
const INPUT_CLASS =
  "w-full border border-canvas/30 bg-transparent px-3 py-2.5 font-sans text-sm text-canvas placeholder:text-canvas/50 focus:border-canvas focus:outline-none";

export function NewsletterSignup() {
  const t = useT();
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (channel === "email" && !/.+@.+\..+/.test(email)) {
      setMsg(t("stockNotify.error.email"));
      setState("fail");
      return;
    }
    if (channel === "whatsapp" && phone.replace(/\D/g, "").length < 9) {
      setMsg(t("stockNotify.error.phone"));
      setState("fail");
      return;
    }
    setState("busy");
    try {
      const r = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(channel === "email" ? { channel, email } : { channel, phone }),
      });
      if (r.ok) {
        setState("done");
        setMsg(
          channel === "email"
            ? "Bedankt — kijk in je inbox voor een bevestiging."
            : "Bedankt — je hoort binnenkort van ons via WhatsApp."
        );
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
    <div>
      <div className="mb-2 inline-flex rounded-card border border-canvas/30 p-0.5">
        {(["email", "whatsapp"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              setChannel(c);
              setState("idle");
              setMsg("");
            }}
            aria-pressed={channel === c}
            className={`px-3 py-1 font-sans text-xs transition-colors ${
              channel === c ? "bg-canvas text-ink" : "text-canvas/70 hover:text-canvas"
            }`}
          >
            {c === "email" ? t("newsletter.emailTab") : t("newsletter.whatsappTab")}
          </button>
        ))}
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-2 sm:flex-row">
        {channel === "email" ? (
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("newsletter.emailPlaceholder")}
            aria-label={t("checkout.email")}
            className={INPUT_CLASS}
          />
        ) : (
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t("newsletter.phonePlaceholder")}
            aria-label="Telefoonnummer"
            className={INPUT_CLASS}
          />
        )}
        <button
          type="submit"
          disabled={state === "busy"}
          className="inline-flex items-center justify-center border border-canvas bg-canvas px-5 py-2.5 font-sans text-sm font-medium text-ink transition-colors hover:bg-surface disabled:opacity-50"
        >
          {state === "busy" ? t("common.processing") : t("newsletter.submit")}
        </button>
      </form>
      {msg && state !== "busy" ? (
        <span role="alert" className="mt-1 block font-sans text-xs text-canvas/70">
          {msg}
        </span>
      ) : null}
    </div>
  );
}
