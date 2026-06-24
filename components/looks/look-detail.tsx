"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEuro } from "@/lib/pricing";
import type { ResolvedLook, LookBuyData, LookGalleryImage, LookColorOption } from "@/lib/looks";
import { useCart } from "@/components/cart/cart-context";
import { track } from "@/lib/track-client";
import { SizeMatrix } from "@/components/pdp/size-matrix";
import { useT } from "@/components/i18n/locale-provider";

type LightboxState = { images: { url: string; alt: string }[]; index: number } | null;

/** Vergroot-icoon (overlay) — geeft aan dat een afbeelding klikbaar is. */
function ZoomBadge() {
  return (
    <span className="pointer-events-none absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-canvas/80 opacity-0 shadow-pop transition-opacity group-hover:opacity-100">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3M11 8v6M8 11h6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/**
 * Rijke look-detailpagina: sfeerbeeld-hero + galerij (klikbaar → lightbox met
 * zoom-icoon), storytelling, en een shoppbare productlijst zonder de pagina te
 * verlaten (geen PDP-links). Kleur-switcher wisselt het product-/pakbeeld én de
 * koop-variant. Toevoegen geeft een subtiele toast i.p.v. een grote modal.
 */
export function LookDetail({
  look,
  hero,
  gallery,
  colorOptions,
  buy,
}: {
  look: ResolvedLook;
  hero: string;
  gallery: LookGalleryImage[];
  colorOptions: Record<string, LookColorOption[]>;
  buy: Record<string, LookBuyData>;
}) {
  const cart = useCart();
  const t = useT();
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [added, setAdded] = useState<Record<number, boolean>>({});
  const [colorSel, setColorSel] = useState<Record<number, string>>({});
  const [sizeDrawer, setSizeDrawer] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<LightboxState>(null);

  const items = look.products.filter((h) => h.product);

  // Hero + galerij samen voor de lightbox-navigatie.
  const heroImages = useMemo(() => [{ url: hero, alt: look.title }, ...gallery.map((g) => ({ url: g.url, alt: g.alt }))], [hero, gallery, look.title]);

  // Per slot de actieve variant (kleur-switcher) → bepaalt beeld + koopdata.
  function activeHandle(i: number): string {
    return colorSel[i] || look.products[i].handle;
  }
  function activeImage(i: number): string {
    const base = look.products[i];
    const opts = colorOptions[base.handle];
    const sel = opts?.find((o) => o.handle === activeHandle(i));
    return sel?.imageUrl || base.product?.imageUrl || "";
  }

  const close = useCallback(() => setLightbox(null), []);
  const step = useCallback(
    (dir: number) => setLightbox((cur) => (cur === null ? cur : { ...cur, index: (cur.index + dir + cur.images.length) % cur.images.length })),
    [],
  );
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, close, step]);

  function addItem(i: number, sizeOverride?: string) {
    const base = look.products[i];
    if (!base.product) return;
    const handle = activeHandle(i);
    const data = buy[handle];
    const size = sizeOverride ?? picked[i];
    if (!data || !size) return;
    const s = data.sizes.find((x) => x.size === size);
    if (!s || s.qty <= 0) return;
    cart.add(
      {
        sku: s.sku,
        productHandle: handle,
        title: base.product.title,
        size: s.size,
        color: data.color === "Standaard" ? "" : data.color,
        priceCents: s.priceCents,
        imageUrl: activeImage(i) || base.product.imageUrl,
        qty: 1,
        hoofdgroep: data.hoofdgroep,
      },
      { quiet: true },
    );
    setAdded((p) => ({ ...p, [i]: true }));
    track("add_to_cart", { handle, props: { fromLook: look.slug } });
    setTimeout(() => setAdded((p) => ({ ...p, [i]: false })), 1800);
  }

  // Maat-drawer state (één tegelijk).
  const dh = sizeDrawer !== null ? look.products[sizeDrawer] : null;
  const dHandle = sizeDrawer !== null ? activeHandle(sizeDrawer) : "";
  const dData = dHandle ? buy[dHandle] : undefined;
  const dSel = sizeDrawer !== null ? picked[sizeDrawer] : undefined;
  const dSelSize = dData?.sizes.find((s) => s.size === dSel);

  const storyParas = (look.story || "").split(/\n+/).map((p) => p.trim()).filter(Boolean);

  return (
    <div className="grid gap-8 lg:grid-cols-[1.05fr_1fr]">
      {/* ── Sfeerbeeld-hero + galerij ─────────────────────────────── */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setLightbox({ images: heroImages, index: 0 })}
          className="group relative block aspect-[4/5] w-full overflow-hidden rounded-card bg-surface"
          aria-label={t("looks.detail.viewFullScreen")}
        >
          <Image src={hero} alt={look.title} fill priority sizes="(max-width:1024px) 100vw, 50vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
          <ZoomBadge />
        </button>

        {gallery.length ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {gallery.map((g, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setLightbox({ images: heroImages, index: idx + 1 })}
                className="group relative aspect-[4/5] overflow-hidden rounded-card bg-surface"
                aria-label={`Bekijk ${g.alt}`}
              >
                <Image src={g.url} alt={g.alt} fill sizes="(max-width:1024px) 25vw, 12vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                <ZoomBadge />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* ── Verhaal + koop-paneel ─────────────────────────────────── */}
      <div className="flex flex-col">
        <p className="label-brand">{look.occasion}{look.theme ? ` · ${look.theme}` : ""}</p>
        <h1 className="mt-1 text-display-md">{look.title}</h1>
        {look.subtitle ? <p className="mt-2 font-sans text-base text-ink-soft">{look.subtitle}</p> : null}

        {storyParas.length ? (
          <div className="mt-4 space-y-3 border-l-2 border-line pl-4">
            {storyParas.map((p, i) => (
              <p key={i} className="font-sans text-sm leading-relaxed text-ink-soft">{p}</p>
            ))}
          </div>
        ) : null}

        <p className="label-brand mt-8">{t("looks.detail.inThisLook")}</p>
        <ul className="mt-3">
          {items.map((h) => {
            const i = look.products.indexOf(h);
            const num = items.indexOf(h) + 1;
            const handle = activeHandle(i);
            const data = buy[handle];
            const opts = colorOptions[h.handle];
            const sel = picked[i];
            const selSize = data?.sizes.find((s) => s.size === sel);
            const price = formatEuro(selSize?.priceCents ?? h.product!.minPriceCents);
            const img = activeImage(i);
            const shoppable = Boolean(data && data.sizes.length);
            // Alleen ECHTE one-size (One/OS) → direct toevoegen; een enkele normale
            // maat opent de drawer zodat de klant die maat ziet.
            const single = Boolean(data && data.sizes.length === 1 && /^(one|one\s?size|os|onesize|é{0,2}n maat)$/i.test(String(data.sizes[0].size).trim()));
            return (
              <li key={i} className="group flex items-start gap-4 border-b border-line py-4 first:border-t last:border-b-0">
                <button
                  type="button"
                  onClick={() => img && setLightbox({ images: [{ url: img, alt: h.product!.title }], index: 0 })}
                  className="group/img relative h-24 w-[4.5rem] shrink-0 overflow-hidden rounded-card bg-surface"
                  aria-label={`Bekijk ${h.product!.title} op volledige grootte`}
                >
                  {img ? <Image src={img} alt={h.product!.title} fill sizes="72px" className="object-cover transition-transform duration-500 group-hover/img:scale-[1.04]" /> : null}
                  <span className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink/85 font-sans text-[0.6rem] font-medium text-canvas">{num}</span>
                  <span className="pointer-events-none absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-canvas/85 opacity-0 shadow-pop transition-opacity group-hover/img:opacity-100">
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" /></svg>
                  </span>
                </button>

                <div className="min-w-0 flex-1">
                  {h.label ? <span className="block font-sans text-[0.6rem] uppercase tracking-[0.14em] text-muted">{h.label}</span> : null}
                  <span className="mt-0.5 block truncate font-sans text-sm font-medium text-ink">{h.product!.title}</span>
                  {data?.specs ? <span className="mt-0.5 block font-sans text-[0.7rem] italic leading-snug text-muted">{data.specs}</span> : null}

                  {/* Kleur-switcher: wisselt het beeld + de koop-variant. */}
                  {opts && opts.length > 1 ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {opts.map((o) => {
                        const isSel = o.handle === handle;
                        return (
                          <button
                            key={o.handle}
                            type="button"
                            title={o.colorLabel}
                            aria-label={`Kleur: ${o.colorLabel}`}
                            aria-pressed={isSel}
                            onClick={() => { setColorSel((p) => ({ ...p, [i]: o.handle })); setPicked((p) => ({ ...p, [i]: "" })); }}
                            className={`h-5 w-5 rounded-full border transition-transform ${isSel ? "border-ink ring-2 ring-ink ring-offset-1" : "border-line hover:scale-110"} ${o.inStock ? "" : "opacity-40"}`}
                            style={{ background: o.gradient ?? o.hex }}
                          />
                        );
                      })}
                      <span className="ml-1 font-sans text-[0.7rem] text-muted">{opts.find((o) => o.handle === handle)?.colorLabel}</span>
                    </div>
                  ) : null}

                  <div className="mt-2.5 flex items-center justify-between gap-3">
                    <span className="font-sans text-sm text-ink">{price}</span>
                    {shoppable ? (
                      <button
                        type="button"
                        onClick={() => (single ? addItem(i, data!.sizes[0].size) : setSizeDrawer(i))}
                        className={`shrink-0 rounded-card border px-3.5 py-1.5 font-sans text-xs font-medium transition-colors ${
                          added[i] ? "border-success bg-success/10 text-success" : sel ? "border-ink bg-ink text-canvas" : "border-ink text-ink hover:bg-ink hover:text-canvas"
                        }`}
                      >
                        {added[i] ? t("looks.detail.added") : single ? t("looks.detail.addToCart") : sel ? `Maat ${sel}` : t("looks.detail.chooseSizeBtn")}
                      </button>
                    ) : (
                      <span className="shrink-0 font-sans text-xs text-muted">{t("common.temporarilyUnavailable")}</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="mt-4 font-sans text-xs text-muted">{t("delivery.returnAndStyling")}</p>
      </div>

      {/* ── Maat-drawer ───────────────────────────────────────────── */}
      {sizeDrawer !== null && dh?.product && dData ? (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={t("looks.detail.sizeDrawerTitle")}>
          <div className="absolute inset-0 bg-ink/40" onClick={() => setSizeDrawer(null)} />
          <div className="absolute inset-y-0 right-0 flex w-[92%] max-w-md flex-col overflow-y-auto bg-canvas p-5 shadow-drawer">
            <div className="mb-4 flex items-center justify-between">
              <p className="label-brand">{t("looks.detail.sizeDrawerTitle")}</p>
              <button type="button" onClick={() => setSizeDrawer(null)} className="font-sans text-sm underline underline-offset-2">{t("look.drawer.close")}</button>
            </div>

            <div className="flex items-start gap-3">
              <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-card bg-surface">
                {activeImage(sizeDrawer) ? <Image src={activeImage(sizeDrawer)} alt={dh.product.title} fill sizes="64px" className="object-cover" /> : null}
              </div>
              <div className="min-w-0">
                {dh.label ? <span className="block font-sans text-[0.65rem] uppercase tracking-wide text-muted">{dh.label}</span> : null}
                <p className="font-sans text-sm font-medium">{dh.product.title}</p>
                {dData.specs ? <span className="mt-0.5 block font-sans text-[0.7rem] italic leading-snug text-ink-soft/80">{dData.specs}</span> : null}
                <span className="mt-0.5 block font-sans text-sm text-ink-soft">{formatEuro(dSelSize?.priceCents ?? dh.product.minPriceCents)}</span>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="font-sans text-xs text-muted">{t("looks.detail.sizeLabel")}</span>
              <Link href="/maatadvies" className="font-sans text-xs text-ink underline underline-offset-2">{t("look.drawer.sizeAdvice")}</Link>
            </div>
            <SizeMatrix
              sizes={dData.sizes.map((s) => ({ ...s, known: true }))}
              hoofdgroep={dData.hoofdgroep}
              selected={dSel ?? null}
              onSelect={(size) => setPicked((p) => ({ ...p, [sizeDrawer!]: size }))}
            />

            <button
              type="button"
              onClick={() => { addItem(sizeDrawer!); setSizeDrawer(null); }}
              disabled={!dSelSize || (dSelSize?.qty ?? 0) <= 0}
              className="btn-primary mt-5 w-full"
            >
              {!dSel ? t("looks.detail.chooseOneCtaDrawer") : dSelSize && dSelSize.qty <= 0 ? t("common.soldOut") : `In winkelwagen — maat ${dSel}`}
            </button>
            <p className="mt-2 text-center font-sans text-xs text-muted">{t("look.drawer.returnNote")}</p>
          </div>
        </div>
      ) : null}

      {/* ── Lightbox (volledige grootte) ──────────────────────────── */}
      {lightbox ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/90 p-4" role="dialog" aria-modal="true" aria-label={t("looks.detail.lightboxTitle")}>
          <button type="button" onClick={close} aria-label={t("look.drawer.close")} className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-canvas/10 text-canvas hover:bg-canvas/20">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" /></svg>
          </button>
          {lightbox.images.length > 1 ? (
            <>
              <button type="button" onClick={() => step(-1)} aria-label={t("common.previous")} className="absolute left-3 flex h-11 w-11 items-center justify-center rounded-full bg-canvas/10 text-canvas hover:bg-canvas/20 sm:left-6">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button type="button" onClick={() => step(1)} aria-label={t("common.next")} className="absolute right-3 flex h-11 w-11 items-center justify-center rounded-full bg-canvas/10 text-canvas hover:bg-canvas/20 sm:right-6">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </>
          ) : null}
          <div className="relative h-[85vh] w-[92vw] max-w-3xl">
            <Image src={lightbox.images[lightbox.index].url} alt={lightbox.images[lightbox.index].alt} fill sizes="92vw" className="object-contain" />
          </div>
          {lightbox.images.length > 1 ? (
            <span className="absolute bottom-5 left-1/2 -translate-x-1/2 font-sans text-sm text-canvas/80">{lightbox.index + 1} / {lightbox.images.length}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
