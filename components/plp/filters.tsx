"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import type { Facets, ProductSort } from "@/lib/catalog";
import { colorSwatch } from "@/lib/colors";
import { buildPlpQuery, type PlpSelection } from "@/lib/plp-params";
import { useT } from "@/components/i18n/locale-provider";
import { useModalA11y } from "@/components/hooks/use-modal-a11y";
import { SortSelect } from "@/components/plp/sort-select";
import { track } from "@/lib/track-client";
import { SIZE_SYSTEM_ORDER, sizeSystemKey, type SizeSystem } from "@/lib/size-taxonomy";
import { StoreChooser } from "@/components/stores/store-chooser";
import type { PlpStoreOption } from "@/lib/plp-store";

type Props = {
  facets: Facets;
  selection: PlpSelection;
  total: number;
  /**
   * Opgeslagen maat van de ingelogde klant voor deze categorie (Shop in jouw
   * maat). `facet` is de facetwaarde mét matensysteem, `row` de kale
   * lettermaat-rij (nog gebruikt voor de ranking).
   */
  mySize?: { row: string; raw: string; facet: string } | null;
  /** Actieve sortering — de sticky pil belooft "Filter & sorteer", dus de mobiele
      drawer moet óók een sorteer-keuze bevatten. */
  sort?: ProductSort;
  /** Winkels van de klant (+ wat er in de URL staat) — hier alleen nog om te
   *  weten óf er al een winkel gekozen is; het filteren zelf staat als pil bij
   *  de resultaten. */
  storeOptions?: PlpStoreOption[];
  /**
   * A/B: vaste zijkolom (standaard) of een knop met lade bovenaan, ook op
   * desktop. Mobiel verandert er niets — daar was het altijd al een lade.
   */
  positie?: "zijkant" | "boven";
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


/** Eén regel per filterkeuze: welk facet, welke waarde, aan of uit. */
function trackFilter(facet: string, value: string, on: boolean) {
  track("filter", { props: { facet, value, on } });
}

export function PlpFilters({ facets, selection, total, mySize, sort, storeOptions = [], positie = "zijkant" }: Props) {
  /* "boven" laat de vaste zijkolom vallen en geeft ook desktop de knop-plus-lade
     die mobiel al had. Dat is de klassieke merchandising-afweging: filters altijd
     in beeld (meer verfijnen) versus een breder productraster (meer producten per
     scherm). Één schakelaar, dezelfde lade — geen tweede filterimplementatie. */
  const bovenaan = positie === "boven";
  const alleenMobiel = bovenaan ? "" : "lg:hidden";
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [openMobile, setOpenMobile] = useState(false);
  // De zwevende pil pas tonen als de top-filterbalk uit beeld is gescrold —
  // bovenaan de pagina stonden anders twee bedieningslagen tegelijk.
  const topBarRef = useRef<HTMLDivElement>(null);
  const [pillOn, setPillOn] = useState(false);
  useEffect(() => {
    const el = topBarRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setPillOn(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // Modal-a11y voor de mobiele drawer: focus-trap, Escape-sluit, scroll-lock,
  // focus-restore + #main inert. Portal naar body is verplicht bij inertMain —
  // de drawer rendert binnen #main en zou zichzelf anders inert maken.
  const drawerRef = useRef<HTMLDivElement>(null);
  useModalA11y(drawerRef, { onClose: () => setOpenMobile(false), active: openMobile, inertMain: true });
  // Drawer is lg:hidden maar de scroll-lock/inert hangen aan state: groeit het venster
  // naar desktop terwijl de drawer open staat, dan lijkt de pagina bevroren (onzichtbare
  // modal houdt #main inert). Sluit 'm dus zodra de viewport ≥ lg wordt.
  useEffect(() => {
    if (!openMobile || bovenaan) return; // bovenaan is de lade óók op desktop de bediening
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => { if (mq.matches) setOpenMobile(false); };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [openMobile]);

  // "Shop in jouw maat": alleen tonen als de bewaarde maat hier ook echt
  // bestaat (in de facetten van deze categorie).
  const myFacet = mySize?.facet ? facets.sizes.find((s) => s.value === mySize.facet) : null;
  const myActive = Boolean(myFacet && selection.sizes.length === 1 && selection.sizes[0] === mySize!.facet);

  // Maten gegroepeerd per matensysteem, in de vaste weergavevolgorde. Staat er
  // maar één systeem in deze resultatenset? Dan zijn subkopjes alleen ruis.
  const sizeGroups = SIZE_SYSTEM_ORDER
    .map((system) => ({ system, items: facets.sizes.filter((s) => s.system === system) }))
    .filter((g) => g.items.length > 0);
  const showSizeHeadings = sizeGroups.length > 1;

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
    (selection.priceMin || selection.priceMax ? 1 : 0) +
    selection.stores.length;

  const body = (
    <div className={pending ? "opacity-60 transition-opacity" : ""}>
      {/* "Shop in jouw maat" stond hier als zwart blok bovenaan. Dat las als een
          waarschuwing terwijl het een service is, en het dubbelde met het
          maatfilter eronder. Het staat nu als chip bij de resultaten
          (components/plp/active-chips): aan = gevuld met een kruisje, uit = een
          omlijnd aanbod. Zie PlpActiveChips voor de afweging. */}
      {/* Winkelvoorraad — "ligt dit in mijn winkel?" is een andere vraag dan "is
          het leverbaar". Het stond hier als aanvinklijst in een kadertje; het
          staat nu als pil bij de resultaten, naast "Alleen mijn maat"
          (components/plp/active-chips). Dezelfde soort keuze hoort er hetzelfde
          uit te zien, en daar zie je meteen wat 'ie oplevert.
          Wat hier blijft: de uitnodiging voor wie nog géén winkel koos — dan valt
          er bij de resultaten niets aan te bieden en zou de keuze nergens staan. */}
      {storeOptions.length === 0 ? (
        <div className="mb-4 border border-line p-3">
          <p className="label-brand">{t("plp.filters.storeStock")}</p>
          <StoreChooser variant="card" bron="plp" />
        </div>
      ) : null}

      {/* Maat staat bewust bovenaan en open: is het er niet in jouw maat, dan
          doet de rest er niet toe. Binnen de groep staan de maten per
          matensysteem (kleding · boordmaat · schoen · riem · …), want die
          getallen betekenen per systeem iets anders. */}
      {facets.sizes.length > 0 ? (
        <FilterGroup title={t("plp.filters.size")} defaultOpen>
          <div className="space-y-3">
            {sizeGroups.map((g) => (
              <div key={g.system}>
                {/* "Eén maat" spreekt als chip al voor zichzelf — een kopje
                    erboven zou letterlijk hetzelfde woord herhalen. */}
                {showSizeHeadings && g.system !== "eenmaat" ? (
                  <p className="mb-1.5 font-sans text-[11px] uppercase tracking-wide text-muted">
                    {t(sizeSystemKey(g.system as SizeSystem))}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {g.items.map((s) => {
                    const active = selection.sizes.includes(s.value);
                    return (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => { trackFilter("maat", s.value, !selection.sizes.includes(s.value)); apply({ sizes: toggle(selection.sizes, s.value) }); }}
                        aria-pressed={active}
                        title={`${s.label} (${s.count})`}
                        className={`min-h-11 min-w-[3rem] border px-2 py-1.5 text-center font-sans text-xs transition-colors lg:min-h-0 ${
                          active ? "border-ink bg-ink text-canvas" : "border-line hover:border-muted"
                        }`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </FilterGroup>
      ) : null}

      {/* Type (subgroep) — bv. Chino/Pantalon/Lange mouw/2-delig */}
      {facets.types.length > 1 ? (
        <FilterGroup title={t("plp.filters.type")} defaultOpen>
          <CheckList
            items={facets.types.map((tp) => ({ value: tp.value, label: tp.label, count: tp.count }))}
            selected={selection.types}
            onToggle={(v) => { trackFilter("type", v, !selection.types.includes(v)); apply({ types: toggle(selection.types, v) }); }}
          />
        </FilterGroup>
      ) : null}

      {/* Kleur */}
      {facets.colors.length > 0 ? (
        <FilterGroup title={t("plp.filters.color")} defaultOpen>
          {/* Vast raster van twee gelijke kolommen. Met flex-wrap kreeg elke chip
              zijn eigen breedte naar gelang de kleurnaam, waardoor de rechterrand
              rafelde en de aantallen nergens onder elkaar stonden. */}
          <div className="grid grid-cols-2 gap-2">
            {facets.colors.map((c) => {
              const sw = colorSwatch(c.label);
              const active = selection.colors.includes(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => { trackFilter("kleur", c.key, !selection.colors.includes(c.key)); apply({ colors: toggle(selection.colors, c.key) }); }}
                  aria-pressed={active}
                  title={`${c.label} (${c.count})`}
                  // Selectie via ring + vetgedrukt label — niet alléén randkleur (duidelijk
                  // voor kleurenblinde gebruikers).
                  className={`flex min-h-11 w-full items-center gap-1.5 border px-1.5 py-1.5 font-sans text-xs transition-colors lg:min-h-0 ${
                    active ? "border-ink ring-1 ring-ink font-medium" : "border-line hover:border-muted"
                  }`}
                >
                  <span
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 rounded-full border border-line"
                    style={{ background: sw.gradient ?? sw.hex }}
                  />
                  {/* Krappe binnenruimte zodat ook de langste kleurnaam
                      ("Multikleur") heel past. Lukt het toch niet, dan kort de naam
                      in (…) in plaats van de chip breder te maken — de titel toont
                      de volledige naam. Het aantal staat met ml-auto tegen de
                      rechterrand, zodat de cijfers in beide kolommen uitlijnen. */}
                  <span className="min-w-0 truncate">{c.label}</span>
                  <span className="ml-auto shrink-0 text-[0.7rem] text-muted">{c.count}</span>
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
            items={facets.fits.map((fit) => ({ value: fit.value, label: fit.label ?? fit.value, count: fit.count }))}
            selected={selection.fits}
            onToggle={(v) => { trackFilter("pasvorm", v, !selection.fits.includes(v)); apply({ fits: toggle(selection.fits, v) }); }}
          />
        </FilterGroup>
      ) : null}

      {/* Materiaal */}
      {facets.materials.length > 1 ? (
        <FilterGroup title={t("plp.filters.material")}>
          <CheckList
            items={facets.materials.map((m) => ({ value: m.value, label: m.label ?? m.value, count: m.count }))}
            selected={selection.materials}
            onToggle={(v) => { trackFilter("materiaal", v, !selection.materials.includes(v)); apply({ materials: toggle(selection.materials, v) }); }}
          />
        </FilterGroup>
      ) : null}

      {/* Dessin (print_design) */}
      {facets.patterns.length > 1 ? (
        <FilterGroup title={t("plp.filters.pattern")}>
          <CheckList
            items={facets.patterns.map((pt) => ({ value: pt.value, label: pt.label ?? pt.value, count: pt.count }))}
            selected={selection.patterns}
            onToggle={(v) => { trackFilter("dessin", v, !selection.patterns.includes(v)); apply({ patterns: toggle(selection.patterns, v) }); }}
          />
        </FilterGroup>
      ) : null}

      {/* Seizoen */}
      {facets.seasons.length > 1 ? (
        <FilterGroup title={t("plp.filters.season")}>
          <CheckList
            items={facets.seasons.map((s) => ({ value: s.value, label: s.label ?? s.value, count: s.count }))}
            selected={selection.seasons}
            onToggle={(v) => { trackFilter("seizoen", v, !selection.seasons.includes(v)); apply({ seasons: toggle(selection.seasons, v) }); }}
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
                className={`min-h-11 border px-2.5 py-1.5 font-sans text-xs transition-colors lg:min-h-0 ${
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
          // Wist het winkel-FILTER, niet je winkelkeuze zelf: die blijft in de
          // keuzelijst staan (en in de cookie) zodat één klik 'm terugzet.
          onClick={() => apply({ types: [], materials: [], patterns: [], seasons: [], ironFree: false, colors: [], sizes: [], fits: [], priceMin: undefined, priceMax: undefined, stores: [] })}
          className="mt-2 font-sans text-sm text-ink underline underline-offset-4"
        >
          {t("plp.filters.clearAllPrefix")} ({activeCount})
        </button>
      ) : null}
    </div>
  );

  return (
    <>
      {/* Mobiel: filterknop bovenaan; de zwevende pil verschijnt pas zodra deze
          balk uit beeld scrolt (anders twee bedieningslagen tegelijk). */}
      <div ref={topBarRef} className={`mb-4 flex items-center justify-between ${alleenMobiel}`}>
        <button
          type="button"
          onClick={() => setOpenMobile(true)}
          className="btn-ghost !px-4 !py-2.5"
        >
          {t("plp.filters.filterAndSortMobileSticky")} {activeCount > 0 ? `(${activeCount})` : ""}
        </button>
        <span className="font-sans text-sm text-muted">{total} {t("plp.filters.itemPlural")}</span>
      </div>
      {pillOn ? (
        <button
          type="button"
          onClick={() => setOpenMobile(true)}
          className={`fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full border border-ink bg-canvas px-5 py-2.5 font-sans text-sm font-medium shadow-pop ${alleenMobiel}`}
        >
          {t("plp.filters.filterAndSortMobileSticky")} {activeCount > 0 ? `· ${activeCount}` : ""}
        </button>
      ) : null}

      {openMobile && typeof document !== "undefined"
        ? createPortal(
            <div className={`fixed inset-0 z-50 ${alleenMobiel}`} role="dialog" aria-modal="true" aria-label={t("plp.filters.mobileDrawerTitle")}>
              <div className="absolute inset-0 bg-ink/40" onClick={() => setOpenMobile(false)} />
              <div ref={drawerRef} tabIndex={-1} className="absolute inset-y-0 right-0 w-[88%] max-w-sm overflow-y-auto scroll-gents bg-canvas p-5 shadow-drawer focus:outline-none">
                <div className="mb-4 flex items-center justify-between">
                  <p className="label-brand">{t("plp.filters.mobileDrawerTitle")}</p>
                  <button type="button" onClick={() => setOpenMobile(false)} className="-mr-2 flex h-11 items-center px-2 font-sans text-sm underline">
                    {t("common.close")}
                  </button>
                </div>
                {/* Sorteren hoort in de drawer: de sticky pil heet "Filter & sorteer",
                    en diep in de lijst is de sorteer-select bovenaan de PLP onbereikbaar. */}
                {sort ? (
                  <div className="mb-4 border-b border-line pb-4">
                    <SortSelect value={sort} />
                  </div>
                ) : null}
                {body}
                {/* Sticky in de scrollzone: de live teller ("Toon N artikelen")
                    blijft zo altijd in beeld, hoe diep je ook in de facetten zit. */}
                <div className="sticky bottom-0 -mx-5 mt-6 border-t border-line bg-canvas px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                  <button type="button" onClick={() => setOpenMobile(false)} className="btn-primary w-full">
                    {t("plp.filters.showCountBtn")} {total} {t("plp.filters.itemPlural")}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {/* Desktop: vaste zijkolom — tenzij de variant de filters bovenaan wil. */}
      {bovenaan ? null : <div className="hidden lg:block">{body}</div>}
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
        // Mobiel (drawer) 44px-rijen; desktop-sidebar blijft compact via lg:.
        <label key={it.value} className="flex min-h-11 cursor-pointer items-center gap-2 font-sans text-sm lg:min-h-0">
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
