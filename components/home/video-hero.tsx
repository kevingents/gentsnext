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
  // De poster is de instant eerste paint (geen zwart), maar de video laadt nu
  // METEEN parallel (niet meer wachten tot de poster volledig binnen is) en fade't
  // in zodra hij écht speelt — zo staat die stilstaande afbeelding zo kort mogelijk.
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const conn = (navigator as any).connection;
    if (conn?.saveData) return; // data-saver → poster laten staan
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const isMobile = window.matchMedia("(max-width: 640px)").matches;
    // Op smalle schermen alleen als er een lichtere mobiele variant is.
    if (isMobile && !videoUrlMobile) return;
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
      {/* Poster blijft altijd zichtbaar als achtergrond (eerste paint = de afbeelding). */}
      <Image
        src={posterUrl}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover opacity-90"
      />
      {src ? (
        <video
          ref={ref}
          src={src}
          poster={posterUrl}
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
