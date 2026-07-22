"use client";

import Link from "next/link";
import { useLocale, useT } from "@/components/i18n/locale-provider";
import { useState } from "react";
import { createPortal } from "react-dom";

type Branch = { store: string; qty: number; openNow?: boolean; openLabel?: string };

/**
 * "Vandaag afhalen in winkel X". Toont aantal winkels met voorraad voor de
 * gekozen maat; klik = volledige modal met ALLE winkels (voorraad/geen voorraad).
 * Met `reserve` (handle+sku) kan de klant per winkel "reserveer om te passen":
 * de voorraad wordt dan hard vastgehouden via de reserverings-rail.
 */
export function ClickAndCollect({ branches, reserve }: { branches: Branch[]; reserve?: { handle: string; sku: string } }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  // Reserveer-om-te-passen-flow binnen de modal.
  const [selStore, setSelStore] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ store: string; validUntil: string | null } | null>(null);
  const available = branches.filter((b) => b.qty > 0);
  if (!available.length) return null;
  const openNow = available.filter((b) => b.openNow).length;
  // Open + op voorraad eerst.
  const sorted = [...branches].sort(
    (a, b) => Number(b.openNow) - Number(a.openNow) || b.qty - a.qty
  );

  async function submitReserve() {
    if (!reserve || !selStore || busy) return;
    setError("");
    if (!form.name.trim()) return setError(t("reserve.error.name"));
    if (!/.+@.+\..+/.test(form.email.trim())) return setError(t("reserve.error.email"));
    setBusy(true);
    try {
      const r = await fetch("/api/reserveren", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: reserve.handle, sku: reserve.sku, store: selStore, ...form }),
      });
      const d = await r.json();
      if (d?.ok) setDone({ store: d.store || selStore, validUntil: d.validUntil || null });
      else setError(String(d?.error || t("reserve.error.generic")));
    } catch {
      setError(t("reserve.error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mt-3">
        <button
          type="button"
          onClick={() => {
            // Verse staat per opening: een eerdere bevestiging/fout mag een
            // nieuwe reservering (bv. andere maat) niet blokkeren.
            setDone(null);
            setSelStore(null);
            setError("");
            setOpen(true);
          }}
          className="flex w-full items-center justify-between border border-line bg-canvas px-4 py-3 text-left font-sans text-sm hover:border-ink"
        >
          <span className="flex items-center gap-2.5">
            {/* Winkel-icoon — visueel duidelijker dan een puntje */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className="shrink-0 text-ink">
              <path d="M3 9l1.5-4.5h15L21 9M3 9v10a1 1 0 001 1h16a1 1 0 001-1V9M3 9h18M9 14h6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-ink">{t("clickCollect.title")}</span>
              <span className="inline-flex items-center gap-1.5 text-xs text-success">
                <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden className="shrink-0"><circle cx="4" cy="4" r="4" fill="currentColor" /></svg>
                <span>
                  {t("clickCollect.available")} {available.length} {available.length === 1 ? t("clickCollect.storeSingular") : t("clickCollect.storePlural")}
                  {openNow > 0 ? <span className="text-muted"> · {openNow} {t("clickCollect.openNow")}</span> : null}
                </span>
              </span>
            </span>
          </span>
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4 shrink-0 text-muted"><path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      {open && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-[60]" role="dialog" aria-label={t("clickCollect.modal.title")} aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-canvas shadow-drawer">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <p className="font-display text-lg">{t("clickCollect.modal.title")}</p>
              <button type="button" onClick={() => setOpen(false)} aria-label={t("common.close")} className="font-sans text-sm underline">
                {t("common.close")}
              </button>
            </div>
            {reserve && !done ? (
              <p className="border-b border-line bg-surface px-5 py-3 font-sans text-xs text-ink-soft">{t("reserve.intro")}</p>
            ) : null}
            {done ? (
              /* Bevestiging — vervangt de lijst zodat de klant niet dubbel reserveert. */
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <svg viewBox="0 0 24 24" className="h-10 w-10 text-success" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M8 12.5l2.5 2.5L16 9.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p className="font-display text-xl font-light">{t("reserve.success.title")}</p>
                <p className="font-sans text-sm text-ink-soft">
                  {t("reserve.success.body", { store: done.store })}
                  {done.validUntil
                    ? ` ${t("reserve.success.until", { date: new Date(done.validUntil).toLocaleDateString(locale === "nl" ? "nl-NL" : locale, { day: "numeric", month: "long" }) })}`
                    : ""}
                </p>
                <button type="button" onClick={() => setOpen(false)} className="btn-primary mt-2">
                  {t("common.close")}
                </button>
              </div>
            ) : (
              <ul className="flex-1 divide-y divide-line overflow-y-auto">
                {sorted.map((b) => {
                  const inStock = b.qty > 0;
                  const selected = selStore === b.store;
                  return (
                    <li key={b.store} className="px-5 py-3 font-sans text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate text-ink">{b.store}</span>
                          {b.openLabel ? (
                            <span className={`text-xs ${b.openNow ? "text-success" : "text-muted"}`}>{b.openLabel}</span>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          {inStock ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-success">
                              <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden className="shrink-0"><circle cx="4" cy="4" r="4" fill="currentColor" /></svg>
                              {b.qty > 5 ? t("clickCollect.modal.inStock") : t("clickCollect.modal.left", { count: b.qty })}
                            </span>
                          ) : (
                            <span className="text-xs text-muted">{t("clickCollect.modal.outOfStock")}</span>
                          )}
                          {reserve && inStock ? (
                            <button
                              type="button"
                              onClick={() => { setSelStore(selected ? null : b.store); setError(""); }}
                              aria-expanded={selected}
                              className={`min-h-11 whitespace-nowrap font-sans text-xs underline underline-offset-4 ${selected ? "font-medium text-ink" : "text-ink"}`}
                            >
                              {t("reserve.cta")}
                            </button>
                          ) : null}
                        </span>
                      </div>
                      {selected ? (
                        <div className="mt-3 border border-line bg-surface p-3">
                          <p className="font-sans text-xs text-ink-soft">{t("reserve.formIntro", { store: b.store })}</p>
                          <div className="mt-2 grid gap-2">
                            <input
                              value={form.name}
                              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                              placeholder={t("reserve.name")}
                              aria-label={t("reserve.name")}
                              autoComplete="name"
                              className="w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
                            />
                            <input
                              type="email"
                              value={form.email}
                              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                              placeholder={t("reserve.email")}
                              aria-label={t("reserve.email")}
                              autoComplete="email"
                              inputMode="email"
                              className="w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
                            />
                            <input
                              type="tel"
                              value={form.phone}
                              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                              placeholder={t("reserve.phone")}
                              aria-label={t("reserve.phone")}
                              autoComplete="tel"
                              inputMode="tel"
                              className="w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
                            />
                          </div>
                          {error ? <p role="alert" className="mt-2 font-sans text-xs text-danger">{error}</p> : null}
                          <button type="button" onClick={submitReserve} disabled={busy} className="btn-primary mt-3 w-full disabled:opacity-60">
                            {busy ? "…" : t("reserve.submit")}
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {!done ? (
              <div className="border-t border-line p-5">
                <Link href="/pages/winkels" onClick={() => setOpen(false)} className="btn-ghost w-full">
                  {t("clickCollect.modal.addresses")}
                </Link>
              </div>
            ) : null}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
