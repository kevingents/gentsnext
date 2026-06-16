"use client";

import Image from "next/image";
import { useState, useEffect, useCallback, useRef } from "react";
import { rowSortIndex } from "@/lib/size-taxonomy";
import { usePdpSize } from "@/components/pdp/pdp-size-context";

type SizeMedia = { threshold: string; url: string; alt: string };
// `contain`: hele beeld tonen (object-contain) i.p.v. bijsnijden — voor staande
// AI-modelfoto's/video (2:3) die anders kop/voeten verliezen in de 4:5-tegel.
type Shot = { url: string; alt: string; badge?: boolean; video?: boolean; contain?: boolean };

/**
 * Mr Marvis-stijl galerij: alle productfoto's in een 2-koloms grid ("2 om 2"),
 * klik op een foto voor een schermvullende zoom (lightbox). De grote-maat-foto
 * wordt vooraan gezet zodra een maat ≥ drempel gekozen is. Een (AI-)productvideo
 * leidt — autoplay/gedempt/loop in het raster, met geluid in de lightbox.
 */
export function Gallery({ images, title, sizeMedia, video }: { images: { url: string; alt: string; contain?: boolean }[]; title: string; sizeMedia?: SizeMedia | null; video?: string | null }) {
  const { sizeLabel } = usePdpSize();
  const [lightbox, setLightbox] = useState<number | null>(null);

  // Mobiele swipe-slider (scroll-snap): bijhouden welke foto in beeld is + erheen springen.
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const [slide, setSlide] = useState(0);
  const onSliderScroll = () => {
    const el = sliderRef.current;
    if (el) setSlide(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
  };
  const goSlide = (i: number) => {
    const el = sliderRef.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  const showLarge = !!sizeMedia && !!sizeLabel && rowSortIndex(sizeLabel) >= rowSortIndex(sizeMedia.threshold);

  // Alt-text: behoud Shopify-alt alleen als hij echt Nederlands is, anders schone NL-fallback.
  function altFor(alt: string, index: number): string {
    const trimmed = (alt || "").trim();
    const looksEnglish = /\b(the|with|smiling|man|stylish|wearing|worn|outfit|shirt|trousers)\b/i.test(trimmed);
    if (!trimmed || looksEnglish) return `${title} — afbeelding ${index + 1}`;
    return trimmed;
  }

  const poster = images[0]?.url || "";
  const shots: Shot[] = [
    ...(video ? [{ url: video, alt: `${title} — video`, video: true, contain: true }] : []),
    ...(showLarge ? [{ url: sizeMedia!.url, alt: sizeMedia!.alt || `${title} — grote maat`, badge: true }] : []),
    ...images.map((img, i) => ({ url: img.url, alt: altFor(img.alt, i), contain: img.contain })),
  ];
  const firstImageIdx = shots.findIndex((s) => !s.video);

  const close = useCallback(() => setLightbox(null), []);
  const step = useCallback(
    (dir: number) => setLightbox((cur) => (cur === null ? cur : (cur + dir + shots.length) % shots.length)),
    [shots.length],
  );
  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, close, step]);

  if (!shots.length) {
    return (
      <div className="flex aspect-[4/5] items-center justify-center rounded-card bg-surface font-sans text-sm text-muted">
        Geen afbeeldingen
      </div>
    );
  }

  return (
    <>
      <div
        ref={sliderRef}
        onScroll={onSliderScroll}
        className="flex snap-x snap-mandatory overflow-x-auto [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:grid-cols-2 sm:gap-3 sm:overflow-visible"
      >
        {shots.map((shot, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setLightbox(i)}
            aria-label={`Vergroot ${shot.alt}`}
            className="group relative aspect-[4/5] w-full shrink-0 snap-start overflow-hidden rounded-card bg-surface sm:w-auto"
          >
            {shot.video ? (
              <video
                src={shot.url}
                poster={poster || undefined}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                className={`absolute inset-0 h-full w-full ${shot.contain ? "object-contain" : "object-cover"}`}
              />
            ) : (
              <Image
                src={shot.url}
                alt={shot.alt}
                fill
                priority={i === firstImageIdx}
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 30vw"
                className={`transition-transform duration-300 group-hover:scale-[1.03] ${shot.contain ? "object-contain" : "object-cover"}`}
              />
            )}
            {shot.video ? (
              <span className="absolute left-3 top-3 flex items-center gap-1.5 bg-ink/85 px-2.5 py-1 font-sans text-[0.65rem] uppercase tracking-wide text-canvas">
                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
                Video
              </span>
            ) : null}
            {shot.badge ? (
              <span className="absolute left-3 top-3 bg-ink/85 px-2.5 py-1 font-sans text-[0.65rem] uppercase tracking-wide text-canvas">
                Getoond in grote maat
              </span>
            ) : null}
            <span className="pointer-events-none absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-canvas/80 opacity-0 shadow-pop transition-opacity group-hover:opacity-100">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
                <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3M11 8v6M8 11h6" strokeLinecap="round" />
              </svg>
            </span>
          </button>
        ))}
      </div>

      {/* Slider-stippen (alleen mobiel) — tik om naar een foto te springen. */}
      {shots.length > 1 ? (
        <div className="mt-3 flex justify-center gap-1.5 sm:hidden">
          {shots.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goSlide(i)}
              aria-label={`Ga naar afbeelding ${i + 1}`}
              aria-current={slide === i}
              className={`h-1.5 rounded-full transition-all ${slide === i ? "w-5 bg-ink" : "w-1.5 bg-line"}`}
            />
          ))}
        </div>
      ) : null}

      {lightbox !== null ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/90 p-4" role="dialog" aria-modal="true" aria-label="Foto vergroot">
          <button type="button" onClick={close} aria-label="Sluiten" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-canvas/10 text-canvas hover:bg-canvas/20">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" /></svg>
          </button>
          {shots.length > 1 ? (
            <>
              <button type="button" onClick={() => step(-1)} aria-label="Vorige" className="absolute left-3 flex h-11 w-11 items-center justify-center rounded-full bg-canvas/10 text-canvas hover:bg-canvas/20 sm:left-6">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button type="button" onClick={() => step(1)} aria-label="Volgende" className="absolute right-3 flex h-11 w-11 items-center justify-center rounded-full bg-canvas/10 text-canvas hover:bg-canvas/20 sm:right-6">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </>
          ) : null}
          <div className="relative h-[85vh] w-[92vw] max-w-3xl">
            {shots[lightbox].video ? (
              <video src={shots[lightbox].url} poster={poster || undefined} controls autoPlay loop playsInline className="h-full w-full object-contain" />
            ) : (
              <Image src={shots[lightbox].url} alt={shots[lightbox].alt} fill sizes="92vw" className="object-contain" />
            )}
          </div>
          <span className="absolute bottom-5 left-1/2 -translate-x-1/2 font-sans text-sm text-canvas/80">
            {lightbox + 1} / {shots.length}
          </span>
        </div>
      ) : null}
    </>
  );
}
