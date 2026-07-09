"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import type { Facets } from "@/lib/catalog";
import { colorSwatch } from "@/lib/colors";
import { buildPlpQuery, type PlpSelection } from "@/lib/plp-params";
import { useT } from "@/components/i18n/locale-provider";
import { useModalA11y } from "@/components/hooks/use-modal-a11y";

type Props = {
  facets: Facets;
  selection: PlpSelection;
  total: number;
  /** Opgeslagen maat van de ingelogde klant voor deze categorie (Shop in jouw maat). */
  mySize?: { row: string; raw: string } | null;
};

function priceBrackets(
  maxEuro: number,
  t: (key: string, params?: Record<string, string | number>) => string
): { label: string; min?: number; max?: number }[] {
  const b = [
    { label: t("plp.price.upTo", { amount: 50 }), max: 50 },
    { label: "€ 50 – 100", min: 50, max: 100 },
    { label: "€ 100 – 200", min: 100, max: 200 },
    { label: "€ 200 – 350", min: 200, max: 350 },
    { label: t("plp.price.from", { amount: 350 }), min: 350 },
  ];
  return b.filter((x) => (x.min ?? 0) <= maxEuro);
}

export function PlpFilters({ facets, selection, total, mySize }: Props) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [openMobile, setOpenMobile] = useState(false);
  // Modal-a11y voor de mobiele drawer: focus-trap, Escape-sluit, scroll-lock,
  // focus-restore + #main inert. Portal naar body is verplicht bij inertMain —
  // de drawer rendert binnen #main en zou zichzelf anders inert maken.
  const drawerRef = useRef<HTMLDivElement>(null);
  useModalA11y(drawerRef, { onClose: () => setOpenMobile(false), active: openMobile, inertMain: true });
  // Drawer is lg:hidden maar de scroll-lock/inert hangen aan state: groeit het venster
  // naar desktop terwijl de drawer open staat, dan lijkt de pagina bevroren (onzichtbare
  // modal houdt #main inert). Sluit 'm dus zodra de viewport ≥ lg wordt.
  useEffect(() => {
    if (!openMobile) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => { if (mq.matches) setOpenMobile(false); };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [openMobile]);

  // "Shop in jouw maat": alleen tonen als de bewaarde maat hier ook echt
  // bestaat (in de facetten van deze categorie).
  const myFacet = mySize ? facets.sizes.find((s) => s.value === mySize.row) : null;
  const myActive = Boolean(myFacet && selection.sizes.length === 1 && selection.sizes[0] === mySize!.row);

  function apply(next: Partial<PlpSelection>) {
    const merged: PlpSelection = { ...selection, ...next, page: 1 };
    const qs = buildPlpQuery(merged);
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  const maxEuro = Math.ceil(facets.priceMaxCents / 100);
  const activeCount =
    selection.types.length +
    selection.materials.length +
    selection.patterns.length +
    selection.seasons.length +
    (selection.ironFree ? 1 : 0) +
    selection.colors.length +
    selection.sizes.length +
    selection.fits.length +
    (selection.priceMin || selection.priceMax ? 1 : 0);

  const body = (
    <div className={pending ? "opacity-60 transition-opacity" : ""}>
      {/* Shop in jouw maat — één klik naar alleen je eigen maat */}
      {myFacet && mySize ? (
        <button
          type="button"
          onClick={() => apply({ sizes: myActive ? [] : [mySize.row] })}
          aria-pressed={myActive}
          className={`mb-4 flex w-full items-center gap-2.5 border px-3 py-2.5 text-left transition-colors ${
            myActive ? "border-ink bg-ink text-canvas" : "border-ink bg-canvas hover:bg-surface"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 8h18v8H3zM7 8v3M11 8v5M15 8v3M19 8v5" />
          </svg>
          <span className="min-w-0 flex-1 font-sans text-sm leading-tight">
            <span className="block font-medium">{myActive ? t("plp.filters.viewingMySize") : t("plp.filters.shopMySize")}</span>
            <span className={`block text-xs ${myActive ? "text-canvas/70" : "text-muted"}`}>
              {t("plp.filters.mySizePrefix")} {mySize.raw} · {myFacet.count} {myFacet.count === 1 ? t("plp.filters.itemSingular") : t("plp.filters.itemPlural")}
            </span>
          </span>
          <span className={`shrink-0 font-sans text-xs underline underline-offset-2 ${myActive ? "text-canvas/80" : "text-ink"}`}>
            {myActive ? t("plp.filters.clear") : t("plp.filters.show")}
          </span>
        </button>
      ) : null}

      {/* Type (subgroep) — bv. Chino/Pantalon/Lange mouw/2-delig */}
      {facets.types.length > 1 ? (
        <FilterGroup title={t("plp.filters.type")} defaultOpen>
          <CheckList
            items={facets.types.map((tp) => ({ value: tp.value, label: tp.label, count: tp.count }))}
            selected={selection.types}
            onToggle={(v) => apply({ types: toggle(selection.types, v) })}
          />
        </FilterGroup>
      ) : null}

      {/* Kleur */}
      {facets.colors.length > 0 ? (
        <FilterGroup title={t("plp.filters.color")} defaultOpen>
          <div className="flex flex-wrap gap-2">
            {facets.colors.map((c) => {
              const sw = colorSwatch(c.label);
              const active = selection.colors.includes(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => apply({ colors: toggle(selection.colors, c.key) })}
                  aria-pressed={active}
                  title={`${c.label} (${c.count})`}
                  // Selectie via ring + vetgedrukt label — niet alléén randkleur (duidelijk
                  // voor kleurenblinde gebruikers).
                  className={`flex items-center gap-2 border px-2.5 py-1.5 font-sans text-xs transition-colors ${
                    active ? "border-ink ring-1 ring-ink font-medium" : "border-line hover:border-muted"
                  }`}
                >
                  <span
                    aria-hidden
                    className="h-4 w-4 rounded-full border border-line"
                    style={{ background: sw.gradient ?? sw.hex }}
                  />
                  {c.label}
                  <span className="text-muted">{c.count}</span>
                </button>
              );
            })}
          </div>
        </FilterGroup>
      ) : null}

      {/* Maat (lettermaat-buckets) */}
      {facets.sizes.length > 0 ? (
        <FilterGroup title={t("plp.filters.size")}>
          <div className="flex flex-wrap gap-2">
            {facets.sizes.map((s) => {
              const active = selection.sizes.includes(s.value);
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => apply({ sizes: toggle(selection.sizes, s.value) })}
                  aria-pressed={active}
                  title={`${s.label} (${s.count})`}
                  className={`min-w-[3rem] border px-2 py-1.5 text-center font-sans text-xs transition-colors ${
                    active ? "border-ink bg-ink text-canvas" : "border-line hover:border-muted"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </FilterGroup>
      ) : null}

      {/* Pasvorm */}
      {facets.fits.length > 0 ? (
        <FilterGroup title={t("plp.filters.fit")}>
          <CheckList
            items={facets.fits.map((fit) => ({ value: fit.value, label: fit.value, count: fit.count }))}
            selected={selection.fits}
            onToggle={(v) => apply({ fits: toggle(selection.fits, v) })}
          />
        </FilterGroup>
      ) : null}

      {/* Materiaal */}
      {facets.materials.length > 1 ? (
        <FilterGroup title={t("plp.filters.material")}>
          <CheckList
            items={facets.materials.map((m) => ({ value: m.value, label: m.value, count: m.count }))}
            selected={selection.materials}
            onToggle={(v) => apply({ materials: toggle(selection.materials, v) })}
          />
        </FilterGroup>
      ) : null}

      {/* Dessin (print_design) */}
      {facets.patterns.length > 1 ? (
        <FilterGroup title={t("plp.filters.pattern")}>
          <CheckList
            items={facets.patterns.map((pt) => ({ value: pt.value, label: pt.value, count: pt.count }))}
            selected={selection.patterns}
            onToggle={(v) => apply({ patterns: toggle(selection.patterns, v) })}
          />
        </FilterGroup>
      ) : null}

      {/* Seizoen */}
      {facets.seasons.length > 1 ? (
        <FilterGroup title={t("plp.filters.season")}>
          <CheckList
            items={facets.seasons.map((s) => ({ value: s.value, label: s.value, count: s.count }))}
            selected={selection.seasons}
            onToggle={(v) => apply({ seasons: toggle(selection.seasons, v) })}
          />
        </FilterGroup>
      ) : null}

      {/* Strijkvrij (boolean) */}
      {facets.ironFreeCount > 0 ? (
        <div className="border-b border-line py-3">
          <label className="flex cursor-pointer items-center gap-2 font-sans text-sm">
            <input
              type="checkbox"
              checked={selection.ironFree}
              onChange={() => apply({ ironFree: !selection.ironFree })}
              className="h-4 w-4 accent-ink"
            />
            <span className="label-brand !text-ink">{t("plp.filters.ironFree")}</span>
            <span className="text-muted">{facets.ironFreeCount}</span>
          </label>
        </div>
      ) : null}

      {/* Prijs */}
      <FilterGroup title={t("plp.filters.price")}>
        <div className="flex flex-wrap gap-2">
          {priceBrackets(maxEuro, t).map((b) => {
            const active = (selection.priceMin ?? 0) === (b.min ?? 0) && (selection.priceMax ?? 0) === (b.max ?? 0);
            return (
              <button
                key={b.label}
                type="button"
                onClick={() =>
                  apply(active ? { priceMin: undefined, priceMax: undefined } : { priceMin: b.min, priceMax: b.max })
                }
                aria-pressed={active}
                className={`border px-2.5 py-1.5 font-sans text-xs transition-colors ${
                  active ? "border-ink bg-ink text-canvas" : "border-line hover:border-muted"
                }`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </FilterGroup>

      {activeCount > 0 ? (
        <button
          type="button"
          onClick={() => apply({ types: [], materials: [], patterns: [], seasons: [], ironFree: false, colors: [], sizes: [], fits: [], priceMin: undefined, priceMax: undefined })}
          className="mt-2 font-sans text-sm text-ink underline underline-offset-4"
        >
          {t("plp.filters.clearAllPrefix")} ({activeCount})
        </button>
      ) : null}
    </div>
  );

  return (
    <>
      {/* Mobiel: filterknop bovenaan + sticky-CTA terwijl je scrollt */}
      <div className="mb-4 flex items-center justify-between lg:hidden">
        <button
          type="button"
          onClick={() => setOpenMobile(true)}
          className="btn-ghost !px-4 !py-2"
        >
          {t("plp.filters.mobileButton")} {activeCount > 0 ? `(${activeCount})` : ""}
        </button>
        <span className="font-sans text-sm text-muted">{total} {t("plp.filters.itemPlural")}</span>
      </div>
      <button
        type="button"
        onClick={() => setOpenMobile(true)}
        className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full border border-ink bg-canvas px-5 py-2.5 font-sans text-sm font-medium shadow-pop lg:hidden"
      >
        {t("plp.filters.filterAndSortMobileSticky")} {activeCount > 0 ? `· ${activeCount}` : ""}
      </button>

      {openMobile && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("plp.filters.mobileDrawerTitle")}>
              <div className="absolute inset-0 bg-ink/40" onClick={() => setOpenMobile(false)} />
              <div ref={drawerRef} tabIndex={-1} className="absolute inset-y-0 right-0 w-[88%] max-w-sm overflow-y-auto bg-canvas p-5 shadow-drawer focus:outline-none">
                <div className="mb-4 flex items-center justify-between">
                  <p className="label-brand">{t("plp.filters.mobileDrawerTitle")}</p>
                  <button type="button" onClick={() => setOpenMobile(false)} className="font-sans text-sm underline">
                    {t("common.close")}
                  </button>
                </div>
                {body}
                <button type="button" onClick={() => setOpenMobile(false)} className="btn-primary mt-6 w-full">
                  {t("plp.filters.showCountBtn")} {total} {t("plp.filters.itemPlural")}
                </button>
              </div>
            </div>,
            document.body
          )
        : null}

      {/* Desktop: sidebar */}
      <div className="hidden lg:block">{body}</div>
    </>
  );
}

function FilterGroup({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="border-b border-line py-1 first:pt-0">
      <summary className="flex cursor-pointer list-none items-center justify-between py-3 [&::-webkit-details-marker]:hidden">
        <span className="label-brand">{title}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden
          className="text-muted transition-transform [details[open]_&]:rotate-180"
        >
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  );
}

/**
 * Aanvinklijst met "toon meer": lange facetten (bv. Type met 18 waarden, veel
 * losse 1-tjes) tonen standaard de eerste `maxVisible` (op telling gesorteerd
 * door de server) en klappen de rest pas uit op verzoek — houdt de sidebar netjes.
 */
function CheckList({
  items,
  selected,
  onToggle,
  maxVisible = 8,
}: {
  items: { value: string; label: string; count: number }[];
  selected: string[];
  onToggle: (value: string) => void;
  maxVisible?: number;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, maxVisible);
  return (
    <div className="space-y-1.5">
      {visible.map((it) => (
        <label key={it.value} className="flex cursor-pointer items-center gap-2 font-sans text-sm">
          <input
            type="checkbox"
            checked={selected.includes(it.value)}
            onChange={() => onToggle(it.value)}
            className="h-4 w-4 accent-ink"
          />
          <span className="flex-1">{it.label}</span>
          <span className="text-muted">{it.count}</span>
        </label>
      ))}
      {items.length > maxVisible ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="pt-1 font-sans text-xs text-ink underline underline-offset-2"
        >
          {expanded ? t("plp.filters.showLess") : `${t("plp.filters.showAllPrefix")} ${items.length}`}
        </button>
      ) : null}
    </div>
  );
}
