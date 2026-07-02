"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Props = {
  videoUrl: string;
  videoUrlMobile?: string;
  posterUrl: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  primary: { label: string; href: string };
  secondary?: { label: string; href: string };
};

/**
 * Video-hero. Speelt video alleen waar het zinnig is:
 * - Mobiel & data-saver / prefers-reduced-motion → poster blijft staan
 * - Desktop → laadt video pas wanneer in viewport en autoplay'et muted
 * Poster is altijd het eerste frame zodat de hero meteen vol staat.
 */
export function VideoHero({ videoUrl, videoUrlMobile, posterUrl, eyebrow, title, subtitle, primary, secondary }: Props) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  // De poster tonen we ALLEEN als terugval wanneer de video niet speelt. Speelt de
  // video wél, dan blijft de poster onzichtbaar; de donkere bg-ink overbrugt de korte
  // buffer en de video fade't erin (geen stilstaande afbeelding meer in beeld).
  const [videoOff, setVideoOff] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const conn = (navigator as any).connection;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isMobile = window.matchMedia("(max-width: 640px)").matches;
    // Geen video → poster als terugval: niet ingesteld, data-saver, reduce-motion,
    // of mobiel zonder lichte variant.
    if (!videoUrl || conn?.saveData || reduce || (isMobile && !videoUrlMobile)) {
      setVideoOff(true);
      return;
    }
    setSrc(isMobile ? (videoUrlMobile || videoUrl) : videoUrl);
  }, [videoUrl, videoUrlMobile]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !src) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) v.play().catch(() => {});
          else v.pause();
        }
      },
      { threshold: 0.25 }
    );
    io.observe(v);
    return () => io.disconnect();
  }, [src]);

  return (
    <section className="relative h-[72vh] min-h-[460px] w-full overflow-hidden bg-ink">
      {/* Poster ALLEEN als terugval wanneer de video niet speelt. Speelt de video wél,
          dan tonen we géén poster — de donkere bg-ink overbrugt de korte buffer. */}
      {videoOff ? (
        <Image
          src={posterUrl}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-90"
        />
      ) : null}
      {src ? (
        <video
          ref={ref}
          src={src}
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden
          onCanPlay={() => ref.current?.play().catch(() => {})}
          onPlaying={() => setPlaying(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${playing ? "opacity-100" : "opacity-0"}`}
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/15 to-transparent" />
      <div className="absolute inset-0 mx-auto flex max-w-page flex-col items-start justify-end px-gutter pb-14">
        <p className="label-brand !text-canvas/80">{eyebrow}</p>
        <h1 className="mt-3 max-w-2xl text-display-xl font-light text-canvas">{title}</h1>
        {subtitle ? <p className="mt-4 max-w-lg font-sans text-base text-canvas/85">{subtitle}</p> : null}
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href={primary.href} className="btn-primary !bg-canvas !text-ink hover:!bg-surface">
            {primary.label}
          </Link>
          {secondary ? (
            <Link
              href={secondary.href}
              className="btn-ghost !border-canvas !text-canvas hover:!bg-canvas hover:!text-ink"
            >
              {secondary.label}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
