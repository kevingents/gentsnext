"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useT } from "@/components/i18n/locale-provider";
import { useModalA11y } from "@/components/hooks/use-modal-a11y";
import { StarIcon, type MyStore } from "@/components/stores/my-store-toggle";
import { MAX_MY_STORES } from "@/lib/stores";
import { track } from "@/lib/track-client";

type ApiStore = { name: string; city: string; distanceKm?: number | null };

/**
 * "Kies je winkels" — een echte kiezer, geen ster om te raden.
 *
 * De keuze zat verstopt als icoon in de afhaal-lade: je moest 'm openen, de
 * ster zien staan én snappen dat een ster hier "vaste winkel" betekent. Deze
 * knop zegt in tekst wat 'ie doet, opent een lijst met álle winkels, en toont
 * daarna welke winkels het geworden zijn.
 *
 * Meerdere winkels mogen (thuis, werk, familie) — daarom blijft de lade ópen
 * na een keuze: je bent meestal nog niet klaar. Sluiten doe je zelf.
 *
 * De winkellijst komt uit /api/stores (naam + stad + afstand) en wordt pas bij
 * openen opgehaald: dat scheelt de winkeldata in de bundel van elke
 * productpagina. Die route sorteert op afstand tot de bezoeker (geschat uit het
 * IP door Vercel — geen toestemmingsvraag, niets opgeslagen), zodat de winkel om
 * de hoek bovenaan staat in plaats van Almere op alfabet.
 */
export function StoreChooser({
  myStores = [],
  variant = "row",
  bron = "onbekend",
}: {
  /** Winkelnamen ("GENTS Utrecht") van de gekozen winkels. */
  myStores?: string[];
  /** "row" = uitnodigende regel op de PDP, "link" = kaal tekstknopje,
   *  "card" = gestapeld, voor een smalle kolom zoals de PLP-filters. Daar is
   *  naast de tekst geen 200px over en brak "Kies je winkel(s)" middenin.
   *  "pill" = zelfde vorm als de filter-pillen boven de resultaten: daar staat
   *  de winkelvoorraad, dus daar hoort ook de uitnodiging om er een te kiezen. */
  variant?: "row" | "link" | "card" | "pill";
  /** Waar stond de kiezer? (pdp/plp/winkels) — voor de meting. */
  bron?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stores, setStores] = useState<ApiStore[] | null>(null);
  const [gekozen, setGekozen] = useState<string[]>(myStores);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);
  useModalA11y(panelRef, { onClose: sluit, active: open, inertMain: true });

  // Serverwaarheid wint zodra de pagina opnieuw rendert.
  useEffect(() => setGekozen(myStores), [myStores.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function sluit() {
    setOpen(false);
    // Pas bij sluiten verversen: tijdens het kiezen zou elke klik de pagina
    // eronder opnieuw laten renderen.
    startTransition(() => router.refresh());
  }

  async function toggle(name: string) {
    if (busy) return;
    setBusy(name);
    // Meteen zichtbaar; de server stuurt de echte lijst terug (incl. de grens).
    setGekozen((huidig) => (huidig.includes(name) ? huidig.filter((n) => n !== name) : [...huidig, name]));
    try {
      const r = await fetch("/api/mijn-winkel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toggle: name }),
      });
      const d = (await r.json().catch(() => null)) as { stores?: MyStore[] } | null;
      if (d?.stores) setGekozen(d.stores.map((s) => s.title));
      track("mijn_winkel", { props: { winkel: name, aan: !gekozen.includes(name), aantal: d?.stores?.length ?? 0, bron } });
    } catch {
      /* voorkeur is comfort, geen blocker */
    } finally {
      setBusy("");
    }
  }

  const needle = q.trim().toLowerCase();
  const list = (stores ?? []).filter((s) => !needle || `${s.city} ${s.name}`.toLowerCase().includes(needle));
  const vol = gekozen.length >= MAX_MY_STORES;
  const label = gekozen.length
    ? gekozen.length === 1
      ? gekozen[0]
      : t("myStore.countLabel", { first: gekozen[0], count: gekozen.length - 1 })
    : "";

  const trigger =
    variant === "card" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 block w-full border border-line px-3 py-2.5 text-left transition-colors hover:border-ink"
      >
        <span className="flex items-center gap-2">
          <StarIcon filled={gekozen.length > 0} className="h-4 w-4 shrink-0 text-ink" />
          <span className="min-w-0 font-sans text-sm font-medium text-ink">
            {gekozen.length ? `${t("myStore.badge")}: ${label}` : t("myStore.choose")}
          </span>
        </span>
        <span className="mt-1 block font-sans text-xs leading-snug text-muted">
          {gekozen.length ? t("myStore.explainShort") : t("myStore.explain")}
        </span>
        <span className="mt-1.5 block font-sans text-xs text-ink underline underline-offset-4">
          {gekozen.length ? t("myStore.change") : t("myStore.chooseCta")}
        </span>
      </button>
    ) : variant === "pill" ? (
      /* Zelfde maat en vorm als de aanbod-chip in PlpActiveChips (omlijnd, rond,
         min-h-9): het is ook precies dat — een filter dat je aan kunt zetten,
         alleen moet je eerst zeggen wélke winkel. De ster verwijst naar de
         "mijn winkels"-taal die de PDP en het account al gebruiken. */
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 font-sans text-sm text-ink transition-colors hover:border-ink"
      >
        <StarIcon filled={gekozen.length > 0} className="h-3.5 w-3.5 shrink-0" />
        {gekozen.length ? t("myStore.change") : t("myStore.choose")}
      </button>
    ) : variant === "link" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center font-sans text-xs text-ink underline underline-offset-4 lg:min-h-0"
      >
        {gekozen.length ? t("myStore.change") : t("myStore.choose")}
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex w-full items-center justify-between gap-3 border border-line px-3 py-2.5 text-left transition-colors hover:border-ink"
      >
        <span className="flex items-center gap-2.5">
          <StarIcon filled={gekozen.length > 0} className="h-4 w-4 shrink-0 text-ink" />
          <span className="font-sans text-sm">
            <span className="block font-medium text-ink">{gekozen.length ? `${t("myStore.badge")}: ${label}` : t("myStore.choose")}</span>
            <span className="block text-xs text-muted">{gekozen.length ? t("myStore.explainShort") : t("myStore.explain")}</span>
          </span>
        </span>
        <span className="shrink-0 font-sans text-xs text-ink underline underline-offset-4">
          {gekozen.length ? t("myStore.change") : t("myStore.chooseCta")}
        </span>
      </button>
    );

  return (
    <>
      {trigger}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={t("myStore.choose")}>
              <div className="absolute inset-0 bg-ink/40" onClick={sluit} />
              <div ref={panelRef} tabIndex={-1} className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-canvas shadow-drawer focus:outline-none">
                <div className="flex items-center justify-between border-b border-line px-5 py-4">
                  <p className="font-display text-lg">{t("myStore.choose")}</p>
                  <button type="button" onClick={sluit} className="font-sans text-sm underline">
                    {t("common.close")}
                  </button>
                </div>
                <p className="border-b border-line bg-surface px-5 py-3 font-sans text-xs text-ink-soft">
                  {t("myStore.explain")} {t("myStore.max", { count: MAX_MY_STORES })}
                </p>
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
                  <ul className="flex-1 divide-y divide-line overflow-y-auto scroll-gents">
                    {list.map((s) => {
                      const mine = gekozen.includes(s.name);
                      // Vol? Dan kun je alleen nog wegnemen, niet toevoegen —
                      // zichtbaar uitgezet in plaats van een klik die niets doet.
                      const uit = !mine && vol;
                      return (
                        <li key={s.name}>
                          <button
                            type="button"
                            onClick={() => toggle(s.name)}
                            aria-pressed={mine}
                            disabled={uit}
                            className={`flex min-h-11 w-full items-center justify-between gap-3 px-5 py-3 text-left font-sans text-sm hover:bg-surface disabled:opacity-40 disabled:hover:bg-transparent ${busy === s.name ? "opacity-60" : ""}`}
                          >
                            <span className="flex items-center gap-2">
                              <StarIcon filled={mine} className="h-4 w-4 shrink-0 text-ink" />
                              <span className={mine ? "font-medium text-ink" : "text-ink"}>{s.city}</span>
                              {typeof s.distanceKm === "number" ? (
                                <span className="text-xs text-muted">{t("myStore.km", { km: s.distanceKm })}</span>
                              ) : null}
                            </span>
                            <span className="shrink-0 text-xs text-muted">{mine ? t("myStore.unset") : t("myStore.set")}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="border-t border-line p-4">
                  <button type="button" onClick={sluit} className="btn-primary w-full">
                    {t("myStore.done")}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
