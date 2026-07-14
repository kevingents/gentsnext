"use client";

import { useMemo, useRef, useState } from "react";
import { useT, useLocale } from "@/components/i18n/locale-provider";

/**
 * Boekingsformulier klantafspraken (/afspraak). Volgt het bestaande form-patroon
 * (contact-request-form + retour-flow-tegels): client-validatie met t()-keys,
 * aria-invalid + focus op het eerste foutveld, en keuze-tegels voor het type.
 * De server (/api/afspraak) hervalideert alles en is de autoriteit.
 */

type AfspraakType = "trouwconsult" | "pasafspraak" | "personal-shopping";
type Dagdeel = "ochtend" | "middag" | "avond" | "geen-voorkeur";

const TYPES: { value: AfspraakType; titleKey: string; subKey: string }[] = [
  { value: "trouwconsult", titleKey: "afspraak.type.trouwconsult", subKey: "afspraak.type.trouwconsultSub" },
  { value: "pasafspraak", titleKey: "afspraak.type.pasafspraak", subKey: "afspraak.type.pasafspraakSub" },
  { value: "personal-shopping", titleKey: "afspraak.type.personalShopping", subKey: "afspraak.type.personalShoppingSub" },
];

const DAGDELEN: { value: Dagdeel; key: string }[] = [
  { value: "ochtend", key: "afspraak.dagdeel.ochtend" },
  { value: "middag", key: "afspraak.dagdeel.middag" },
  { value: "avond", key: "afspraak.dagdeel.avond" },
  { value: "geen-voorkeur", key: "afspraak.dagdeel.geenVoorkeur" },
];

/** Lokale kalenderdag + n dagen als yyyy-mm-dd (voor de min/max van de datepicker). */
function plusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const inputCls = "mt-1 w-full rounded-card border bg-canvas px-3 py-2.5 font-sans text-sm text-ink focus:border-ink focus:outline-none";

export function AfspraakForm({ stores, initialStore = "" }: { stores: string[]; initialStore?: string }) {
  const t = useT();
  const locale = useLocale();

  const [type, setType] = useState<AfspraakType>("trouwconsult");
  const [store, setStore] = useState(stores.includes(initialStore) ? initialStore : "");
  const [date, setDate] = useState("");
  const [dagdeel, setDagdeel] = useState<Dagdeel>("geen-voorkeur");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [wensen, setWensen] = useState("");

  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [msg, setMsg] = useState("");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const fieldRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({});
  const errId = "afspraak-err";

  // Datumgrenzen: morgen t/m +90 dagen (server hervalideert in Amsterdam-tijd).
  const minDate = useMemo(() => plusDays(1), []);
  const maxDate = useMemo(() => plusDays(90), []);

  function clearInvalid(k: string) {
    if (invalid.has(k)) setInvalid((prev) => { const n = new Set(prev); n.delete(k); return n; });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Client-validatie met dezelfde regels als de server, zodat de klant een
    // vertaalde melding krijgt vóór de submit.
    const missing: string[] = [];
    if (!store) missing.push("store");
    if (!date) missing.push("date");
    if (!name.trim()) missing.push("name");
    if (!email.trim()) missing.push("email");
    if (missing.length) {
      setInvalid(new Set(missing));
      setMsg(t("afspraak.error.required"));
      setState("fail");
      fieldRefs.current[missing[0]]?.focus();
      return;
    }
    if (!/.+@.+\..+/.test(email)) {
      setInvalid(new Set(["email"]));
      setMsg(t("common.error.emailInvalid"));
      setState("fail");
      fieldRefs.current.email?.focus();
      return;
    }
    if (date < minDate || date > maxDate) {
      setInvalid(new Set(["date"]));
      setMsg(t("afspraak.error.date"));
      setState("fail");
      fieldRefs.current.date?.focus();
      return;
    }
    setInvalid(new Set());
    setState("busy");
    setMsg("");
    try {
      const r = await fetch("/api/afspraak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, store, preferredDate: date, dagdeel, name, email, phone, wensen, locale }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        setState("done");
      } else {
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
      <div className="rounded-card border border-line bg-surface p-6">
        <p className="label-brand">{t("afspraak.done.title")}</p>
        <p className="mt-2 font-sans text-ink-soft">{t("afspraak.done.body")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {/* Type-keuze: 3 tegels, trouwconsult voorop (default) */}
      <fieldset>
        <legend className="label-brand mb-2">{t("afspraak.type.label")}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {TYPES.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setType(opt.value)}
              aria-pressed={type === opt.value}
              className={`min-h-[44px] rounded-card border px-4 py-3 text-left ${type === opt.value ? "border-ink bg-ink/5" : "border-line"}`}
            >
              <span className="block font-sans text-sm font-semibold text-ink">{t(opt.titleKey)}</span>
              <span className="mt-0.5 block font-sans text-xs text-ink-soft">{t(opt.subKey)}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="font-sans text-sm">{t("afspraak.store.label")}<span aria-hidden className="text-danger"> *</span></span>
          <select
            required
            aria-required
            aria-invalid={invalid.has("store") || undefined}
            aria-describedby={invalid.has("store") ? errId : undefined}
            ref={(el) => { fieldRefs.current.store = el; }}
            value={store}
            onChange={(e) => { setStore(e.target.value); clearInvalid("store"); }}
            className={`${inputCls} ${invalid.has("store") ? "border-danger" : "border-line"}`}
          >
            <option value="">{t("afspraak.store.placeholder")}</option>
            {stores.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-sans text-sm">{t("afspraak.date.label")}<span aria-hidden className="text-danger"> *</span></span>
          <input
            type="date"
            required
            aria-required
            min={minDate}
            max={maxDate}
            aria-invalid={invalid.has("date") || undefined}
            aria-describedby={invalid.has("date") ? errId : undefined}
            ref={(el) => { fieldRefs.current.date = el; }}
            value={date}
            onChange={(e) => { setDate(e.target.value); clearInvalid("date"); }}
            className={`${inputCls} ${invalid.has("date") ? "border-danger" : "border-line"}`}
          />
          <span className="mt-1 block font-sans text-xs text-muted">{t("afspraak.date.help")}</span>
        </label>
      </div>

      {/* Dagdeel: knoppengroep — de winkel bevestigt zelf het exacte tijdstip */}
      <fieldset>
        <legend className="font-sans text-sm">{t("afspraak.dagdeel.label")}</legend>
        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DAGDELEN.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDagdeel(opt.value)}
              aria-pressed={dagdeel === opt.value}
              className={`min-h-[44px] rounded-card border px-3 py-2.5 font-sans text-sm ${dagdeel === opt.value ? "border-ink bg-ink/5 text-ink" : "border-line text-ink-soft"}`}
            >
              {t(opt.key)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="font-sans text-sm">{t("afspraak.name.label")}<span aria-hidden className="text-danger"> *</span></span>
          <input
            type="text"
            autoComplete="name"
            required
            aria-required
            aria-invalid={invalid.has("name") || undefined}
            aria-describedby={invalid.has("name") ? errId : undefined}
            ref={(el) => { fieldRefs.current.name = el; }}
            value={name}
            onChange={(e) => { setName(e.target.value); clearInvalid("name"); }}
            className={`${inputCls} ${invalid.has("name") ? "border-danger" : "border-line"}`}
          />
        </label>
        <label className="block">
          <span className="font-sans text-sm">{t("afspraak.email.label")}<span aria-hidden className="text-danger"> *</span></span>
          <input
            type="email"
            autoComplete="email"
            required
            aria-required
            aria-invalid={invalid.has("email") || undefined}
            aria-describedby={invalid.has("email") ? errId : undefined}
            ref={(el) => { fieldRefs.current.email = el; }}
            value={email}
            onChange={(e) => { setEmail(e.target.value); clearInvalid("email"); }}
            className={`${inputCls} ${invalid.has("email") ? "border-danger" : "border-line"}`}
          />
        </label>
        <label className="block">
          <span className="font-sans text-sm">{t("checkout.phone_optional")}</span>
          <input
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={`${inputCls} border-line`}
          />
        </label>
      </div>

      <label className="block">
        <span className="font-sans text-sm">{t("afspraak.wensen.label")}</span>
        {type === "trouwconsult" ? (
          <span className="mt-0.5 block font-sans text-xs text-muted">{t("afspraak.wensen.hintTrouw")}</span>
        ) : null}
        <textarea
          rows={4}
          value={wensen}
          onChange={(e) => setWensen(e.target.value)}
          className={`${inputCls} resize-y border-line`}
        />
      </label>

      {msg && state !== "busy" ? (
        <p id={errId} role="alert" className="font-sans text-sm text-danger">{msg}</p>
      ) : null}

      <button type="submit" disabled={state === "busy"} className="btn-primary w-full sm:w-auto">
        {state === "busy" ? t("common.processing") : t("afspraak.submit")}
      </button>
      <p className="font-sans text-xs text-muted">{t("forms.contact.privacyNote")}</p>
    </form>
  );
}
