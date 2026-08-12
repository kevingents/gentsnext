"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useT } from "@/components/i18n/locale-provider";
import { useModalA11y } from "@/components/hooks/use-modal-a11y";
import { StarIcon } from "@/components/stores/my-store-toggle";

type ApiStore = { name: string; city: string };

/**
 * "Kies je winkel" — een echte kiezer, geen ster om te raden.
 *
 * De keuze zat verstopt als icoon in de afhaal-lade: je moest 'm openen, de
 * ster zien staan én snappen dat een ster hier "vaste winkel" betekent. Deze
 * knop zegt in tekst wat 'ie doet, opent een lijst met álle winkels, en toont
 * daarna gewoon welke winkel het geworden is.
 *
 * De winkellijst komt uit /api/stores (naam + stad) en wordt pas bij openen
 * opgehaald: dat scheelt de winkeldata in de bundel van elke productpagina.
 * /api/mijn-winkel accepteert de winkelnaam, dus meer hebben we hier niet nodig.
 */
export function StoreChooser({
  myStore,
  variant = "row",
}: {
  /** Winkelnaam ("GENTS Utrecht") van de gekozen winkel, of null. */
  myStore?: string | null;
  /** "row" = uitnodigende regel op de PDP, "link" = kaal tekstknopje. */
  variant?: "row" | "link";
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stores, setStores] = useState<ApiStore[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);
  useModalA11y(panelRef, { onClose: () => setOpen(false), active: open, inertMain: true });

  useEffect(() => {
    if (!open || stores) return;
    let afgebroken = false;
    fetch("/api/stores")
      .then((r) => r.json())
      .then((d) => {
        if (!afgebroken) setStores(Array.isArray(d?.stores) ? d.stores : []);
      })
      .catch(() => {
        if (!afgebroken) setStores([]);
      });
    return () => {
      afgebroken = true;
    };
  }, [open, stores]);

  async function pick(name: string) {
    if (busy) return;
    // Nogmaals dezelfde winkel = wissen; dat is de enige manier om terug naar
    // "geen winkel" te komen zonder een apart kruisje in de lijst.
    const next = name === myStore ? "" : name;
    setBusy(name);
    try {
      await fetch("/api/mijn-winkel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store: next }),
      });
      setOpen(false);
      startTransition(() => router.refresh());
    } catch {
      /* voorkeur is comfort, geen blocker */
    } finally {
      setBusy("");
    }
  }

  const needle = q.trim().toLowerCase();
  const list = (stores ?? []).filter((s) => !needle || `${s.city} ${s.name}`.toLowerCase().includes(needle));

  const trigger =
    variant === "link" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center font-sans text-xs text-ink underline underline-offset-4 lg:min-h-0"
      >
        {myStore ? t("myStore.change") : t("myStore.choose")}
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex w-full items-center justify-between gap-3 border border-line px-3 py-2.5 text-left transition-colors hover:border-ink"
      >
        <span className="flex items-center gap-2.5">
          <StarIcon filled={Boolean(myStore)} className="h-4 w-4 shrink-0 text-ink" />
          <span className="font-sans text-sm">
            <span className="block font-medium text-ink">{myStore ? `${t("myStore.badge")}: ${myStore}` : t("myStore.choose")}</span>
            <span className="block text-xs text-muted">{myStore ? t("myStore.explainShort") : t("myStore.explain")}</span>
          </span>
        </span>
        <span className="shrink-0 font-sans text-xs text-ink underline underline-offset-4">
          {myStore ? t("myStore.change") : t("myStore.chooseCta")}
        </span>
      </button>
    );

  return (
    <>
      {trigger}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={t("myStore.choose")}>
              <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
              <div ref={panelRef} tabIndex={-1} className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-canvas shadow-drawer focus:outline-none">
                <div className="flex items-center justify-between border-b border-line px-5 py-4">
                  <p className="font-display text-lg">{t("myStore.choose")}</p>
                  <button type="button" onClick={() => setOpen(false)} className="font-sans text-sm underline">
                    {t("common.close")}
                  </button>
                </div>
                <p className="border-b border-line bg-surface px-5 py-3 font-sans text-xs text-ink-soft">{t("myStore.explain")}</p>
                <div className="border-b border-line px-5 py-3">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t("stores.locator.searchPlaceholder")}
                    aria-label={t("stores.locator.searchAriaLabel")}
                    className="w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
                  />
                </div>
                {stores === null ? (
                  <p className="px-5 py-4 font-sans text-sm text-muted">…</p>
                ) : (
                  <ul className="flex-1 divide-y divide-line overflow-y-auto">
                    {list.map((s) => {
                      const mine = s.name === myStore;
                      return (
                        <li key={s.name}>
                          <button
                            type="button"
                            onClick={() => pick(s.name)}
                            aria-pressed={mine}
                            className={`flex min-h-11 w-full items-center justify-between gap-3 px-5 py-3 text-left font-sans text-sm hover:bg-surface ${busy === s.name ? "opacity-60" : ""}`}
                          >
                            <span className="flex items-center gap-2">
                              <StarIcon filled={mine} className="h-4 w-4 shrink-0 text-ink" />
                              <span className={mine ? "font-medium text-ink" : "text-ink"}>{s.city}</span>
                            </span>
                            <span className="shrink-0 text-xs text-muted">{mine ? t("myStore.unset") : t("myStore.set")}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
