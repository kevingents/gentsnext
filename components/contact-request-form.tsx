"use client";

import { useRef, useState } from "react";
import { useT } from "@/components/i18n/locale-provider";

type Props = {
  /** Type aanvraag — toegevoegd aan de mail-onderwerpregel en payload. */
  channel: "zakelijk" | "students" | "trouw" | "uitvaart" | "algemeen";
  title?: string;
  intro?: string;
  /** Extra velden zichtbaar (bv. 'aantal personen' voor zakelijk/students). */
  showOrg?: boolean;
  showGroupSize?: boolean;
  showDate?: boolean;
};

/**
 * Gedeeld contactformulier voor de zakelijke / studenten / trouw / uitvaart-
 * landings. POSTt naar /api/contact — die routeert het bericht door (Resend
 * naar het juiste team-e-mailadres) of logt het als stub als niet gekoppeld.
 */
export function ContactRequestForm({
  channel,
  title,
  intro,
  showOrg = false,
  showGroupSize = false,
  showDate = false,
}: Props) {
  const t = useT();
  const [form, setForm] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [msg, setMsg] = useState("");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const fieldRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});
  const errId = `contact-err-${channel}`;

  function set(k: string, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
    if (invalid.has(k)) setInvalid((prev) => { const n = new Set(prev); n.delete(k); return n; });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const missing = ["name", "email", "message"].filter((k) => !String(form[k] || "").trim());
    if (missing.length) {
      setInvalid(new Set(missing));
      setMsg(t("forms.contact.required"));
      setState("fail");
      // Focus het eerste ontbrekende veld zodat een toetsenbord-/screenreader-
      // gebruiker meteen bij de fout staat.
      fieldRefs.current[missing[0]]?.focus();
      return;
    }
    setInvalid(new Set());
    setState("busy");
    setMsg("");
    try {
      const r = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, ...form }),
      });
      if (r.ok) {
        setState("done");
        setMsg(t("forms.contact.successWorkday"));
      } else {
        const d = await r.json().catch(() => ({}));
        setState("fail");
        setMsg(d.error || t("forms.error.tryLater"));
      }
    } catch {
      setState("fail");
      setMsg(t("forms.error.tryLater"));
    }
  }

  if (state === "done") {
    return (
      <div className="border border-line bg-surface p-6">
        <p className="label-brand">{t("forms.contact.sent")}</p>
        <p className="mt-2 font-display text-xl font-light">{msg}</p>
      </div>
    );
  }

  return (
    <form
      id={`contact-${channel}`}
      onSubmit={submit}
      noValidate
      className="border border-line bg-canvas p-6"
    >
      <p className="label-brand">{title ?? t("forms.contact.requestInfoTitle")}</p>
      {intro ? <p className="mt-2 font-sans text-sm text-ink-soft">{intro}</p> : null}

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="font-sans text-sm">{t("forms.contact.name")}<span aria-hidden className="text-danger"> *</span></span>
          <input
            type="text"
            required
            aria-required
            aria-invalid={invalid.has("name") || undefined}
            aria-describedby={invalid.has("name") ? errId : undefined}
            ref={(el) => { fieldRefs.current.name = el; }}
            value={form.name || ""}
            onChange={(e) => set("name", e.target.value)}
            className={`mt-1 w-full border bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none ${invalid.has("name") ? "border-danger" : "border-line"}`}
          />
        </label>
        <label className="block">
          <span className="font-sans text-sm">{t("forms.contact.email")}<span aria-hidden className="text-danger"> *</span></span>
          <input
            type="email"
            required
            aria-required
            aria-invalid={invalid.has("email") || undefined}
            aria-describedby={invalid.has("email") ? errId : undefined}
            ref={(el) => { fieldRefs.current.email = el; }}
            value={form.email || ""}
            onChange={(e) => set("email", e.target.value)}
            className={`mt-1 w-full border bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none ${invalid.has("email") ? "border-danger" : "border-line"}`}
          />
        </label>
        <label className="block">
          <span className="font-sans text-sm">{t("checkout.phone_optional")}</span>
          <input
            type="tel"
            value={form.phone || ""}
            onChange={(e) => set("phone", e.target.value)}
            className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
          />
        </label>
        {showOrg ? (
          <label className="block">
            <span className="font-sans text-sm">{t("forms.contact.organisation")}</span>
            <input
              type="text"
              value={form.organisation || ""}
              onChange={(e) => set("organisation", e.target.value)}
              className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
            />
          </label>
        ) : null}
        {showGroupSize ? (
          <label className="block">
            <span className="font-sans text-sm">{t("forms.contact.groupSize")}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={form.groupSize || ""}
              onChange={(e) => set("groupSize", e.target.value)}
              className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
            />
          </label>
        ) : null}
        {showDate ? (
          <label className="block">
            <span className="font-sans text-sm">{t("forms.contact.eventDate")}</span>
            <input
              type="date"
              value={form.eventDate || ""}
              onChange={(e) => set("eventDate", e.target.value)}
              className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
            />
          </label>
        ) : null}
        <label className="block sm:col-span-2">
          <span className="font-sans text-sm">{t("forms.contact.message")}<span aria-hidden className="text-danger"> *</span></span>
          <textarea
            required
            aria-required
            aria-invalid={invalid.has("message") || undefined}
            aria-describedby={invalid.has("message") ? errId : undefined}
            ref={(el) => { fieldRefs.current.message = el; }}
            rows={4}
            value={form.message || ""}
            onChange={(e) => set("message", e.target.value)}
            className={`mt-1 w-full resize-y border bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none ${invalid.has("message") ? "border-danger" : "border-line"}`}
          />
        </label>
      </div>

      {msg && state !== "busy" ? (
        <p id={errId} role="alert" className={`mt-4 font-sans text-sm ${state === "fail" ? "text-danger" : "text-ink-soft"}`}>
          {msg}
        </p>
      ) : null}

      <button type="submit" disabled={state === "busy"} className="btn-primary mt-5 w-full sm:w-auto">
        {state === "busy" ? t("common.processing") : t("forms.contact.submit")}
      </button>
      <p className="mt-3 font-sans text-xs text-muted">
        {t("forms.contact.privacyNote")}
      </p>
    </form>
  );
}
