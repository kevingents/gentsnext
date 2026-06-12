"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import type { Facets } from "@/lib/catalog";
import { colorSwatch } from "@/lib/colors";
import { buildPlpQuery, type PlpSelection } from "@/lib/plp-params";

type Props = {
  facets: Facets;
  selection: PlpSelection;
  total: number;
};

function priceBrackets(maxEuro: number): { label: string; min?: number; max?: number }[] {
  const b = [
    { label: "tot € 50", max: 50 },
    { label: "€ 50 – 100", min: 50, max: 100 },
    { label: "€ 100 – 200", min: 100, max: 200 },
    { label: "€ 200 – 350", min: 200, max: 350 },
    { label: "vanaf € 350", min: 350 },
  ];
  return b.filter((x) => (x.min ?? 0) <= maxEuro);
}

export function PlpFilters({ facets, selection, total }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [openMobile, setOpenMobile] = useState(false);

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
    selection.colors.length +
    selection.sizes.length +
    selection.fits.length +
    (selection.priceMin || selection.priceMax ? 1 : 0);

  const body = (
    <div className={pending ? "opacity-60 transition-opacity" : ""}>
      {/* Kleur */}
      {facets.colors.length > 0 ? (
        <FilterGroup title="Kleur">
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
                  className={`flex items-center gap-2 border px-2.5 py-1.5 font-sans text-xs transition-colors ${
                    active ? "border-ink" : "border-line hover:border-muted"
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

      {/* Maat */}
      {facets.sizes.length > 0 ? (
        <FilterGroup title="Maat">
          <div className="flex flex-wrap gap-2">
            {facets.sizes.map((s) => {
              const active = selection.sizes.includes(s.value);
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => apply({ sizes: toggle(selection.sizes, s.value) })}
                  aria-pressed={active}
                  className={`min-w-[3rem] border px-2 py-1.5 text-center font-sans text-xs transition-colors ${
                    active ? "border-ink bg-ink text-canvas" : "border-line hover:border-muted"
                  }`}
                >
                  {s.value}
                </button>
              );
            })}
          </div>
        </FilterGroup>
      ) : null}

      {/* Pasvorm */}
      {facets.fits.length > 0 ? (
        <FilterGroup title="Pasvorm">
          <div className="space-y-1.5">
            {facets.fits.map((fit) => {
              const active = selection.fits.includes(fit.value);
              return (
                <label key={fit.value} className="flex cursor-pointer items-center gap-2 font-sans text-sm">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => apply({ fits: toggle(selection.fits, fit.value) })}
                    className="h-4 w-4 accent-ink"
                  />
                  <span>{fit.value}</span>
                  <span className="text-muted">{fit.count}</span>
                </label>
              );
            })}
          </div>
        </FilterGroup>
      ) : null}

      {/* Prijs */}
      <FilterGroup title="Prijs">
        <div className="flex flex-wrap gap-2">
          {priceBrackets(maxEuro).map((b) => {
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
          onClick={() => apply({ colors: [], sizes: [], fits: [], priceMin: undefined, priceMax: undefined })}
          className="mt-2 font-sans text-sm text-ink underline underline-offset-4"
        >
          Wis alle filters ({activeCount})
        </button>
      ) : null}
    </div>
  );

  return (
    <>
      {/* Mobiel: filterknop + drawer */}
      <div className="mb-4 flex items-center justify-between lg:hidden">
        <button
          type="button"
          onClick={() => setOpenMobile(true)}
          className="btn-ghost !px-4 !py-2"
        >
          Filters {activeCount > 0 ? `(${activeCount})` : ""}
        </button>
        <span className="font-sans text-sm text-muted">{total} artikelen</span>
      </div>

      {openMobile ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpenMobile(false)} />
          <div className="absolute inset-y-0 right-0 w-[88%] max-w-sm overflow-y-auto bg-canvas p-5 shadow-drawer">
            <div className="mb-4 flex items-center justify-between">
              <p className="label-brand">Filters</p>
              <button type="button" onClick={() => setOpenMobile(false)} className="font-sans text-sm underline">
                Sluiten
              </button>
            </div>
            {body}
            <button type="button" onClick={() => setOpenMobile(false)} className="btn-primary mt-6 w-full">
              Toon {total} artikelen
            </button>
          </div>
        </div>
      ) : null}

      {/* Desktop: sidebar */}
      <div className="hidden lg:block">{body}</div>
    </>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line py-5 first:pt-0">
      <p className="label-brand mb-3">{title}</p>
      {children}
    </section>
  );
}
