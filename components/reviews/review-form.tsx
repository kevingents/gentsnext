"use client";

import { useState } from "react";
import { useT } from "@/components/i18n/locale-provider";

type Props = {
  handle: string;
  orderNumber?: string;
  token?: string;
  /** Productnaam — getoond in de post-purchase context. */
  productTitle?: string;
  /** Open het formulier direct (post-purchase i.p.v. knop-toggle). */
  defaultOpen?: boolean;
};

const FIT_OPTIONS = [
  { value: "klein", label: "Valt klein" },
  { value: "normaal", label: "Valt normaal" },
  { value: "groot", label: "Valt groot" },
];

function Star({ active, size = 26 }: { active: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={active ? "text-ink" : "text-line"} fill="currentColor" aria-hidden>
      <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27z" />
    </svg>
  );
}

export function WriteReview({ handle, orderNumber, token, productTitle, defaultOpen = false }: Props) {
  const t = useT();
  const verified = Boolean(orderNumber && token);
  const [open, setOpen] = useState(defaultOpen);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [fit, setFit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<null | "published" | "pending">(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (rating < 1) {
      setError(t("reviews.error.rating"));
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, rating, title, body, authorName: name, email, fit, orderNumber, token }),
      });
      const d = await r.json();
      if (!d.ok) {
        setError(d.error || t("common.error"));
        return;
      }
      setDone(d.status);
    } catch {
      setError("Kon de review niet versturen.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-card border border-line bg-surface px-4 py-3 font-sans text-sm text-ink-soft">
        {done === "published"
          ? "Bedankt voor je review — hij staat nu online."
          : t("reviews.success.pending")}
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost">
        {t("reviews.form.button")}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-card border border-line p-5">
      {productTitle ? <p className="font-sans text-sm font-medium">{productTitle}</p> : null}

      <div className="mt-1 flex items-center gap-0.5" role="radiogroup" aria-label="Score">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            aria-label={`${n} ${n === 1 ? "ster" : "sterren"}`}
            aria-checked={rating === n}
            role="radio"
            className="p-0.5"
          >
            <Star active={(hover || rating) >= n} />
          </button>
        ))}
      </div>

      <label className="mt-4 block">
        <span className="font-sans text-sm text-ink">
          {t("reviews.form.title")} <span className="text-muted">{t("common.optional")}</span>
        </span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="mt-1.5 w-full border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none" />
      </label>

      <label className="mt-3 block">
        <span className="font-sans text-sm text-ink">{t("reviews.form.body")}</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={4000} placeholder="Hoe bevalt het? Denk aan pasvorm, stof en kwaliteit…" className="mt-1.5 w-full resize-none border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none" />
      </label>

      <fieldset className="mt-3">
        <legend className="font-sans text-sm text-ink">
          {t("reviews.form.fit")} <span className="text-muted">{t("common.optional")}</span>
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {FIT_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setFit(fit === o.value ? "" : o.value)}
              className={`border px-3 py-1.5 font-sans text-xs transition-colors ${fit === o.value ? "border-ink bg-ink text-canvas" : "border-line text-ink-soft hover:border-ink"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>

      {!verified ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="font-sans text-sm text-ink">{t("forms.contact.name")}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="mt-1.5 w-full border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none" />
          </label>
          <label className="block">
            <span className="font-sans text-sm text-ink">
              {t("pdp.stocknotify.email")} <span className="text-muted">(niet zichtbaar)</span>
            </span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} className="mt-1.5 w-full border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none" />
          </label>
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-3 font-sans text-sm text-danger">{error}</p> : null}

      <div className="mt-4 flex items-center gap-3">
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "Versturen…" : t("reviews.form.submit")}
        </button>
        {!defaultOpen ? (
          <button type="button" onClick={() => setOpen(false)} className="font-sans text-sm text-muted underline">
            Annuleer
          </button>
        ) : null}
      </div>
      {!verified ? (
        <p className="mt-2 font-sans text-xs text-muted">Reviews zonder geverifieerde aankoop worden eerst gecontroleerd voor plaatsing.</p>
      ) : null}
    </form>
  );
}
