"use client";

import Image from "next/image";
import { useState } from "react";

export function Gallery({ images, title }: { images: { url: string; alt: string }[]; title: string }) {
  const [active, setActive] = useState(0);
  if (!images.length) {
    return (
      <div className="flex aspect-[4/5] items-center justify-center rounded-card bg-surface font-sans text-sm text-muted">
        Geen afbeeldingen
      </div>
    );
  }
  const main = images[Math.min(active, images.length - 1)];

  return (
    <div className="flex flex-col gap-3 lg:flex-row-reverse lg:gap-4">
      <div className="relative aspect-[4/5] flex-1 overflow-hidden rounded-card bg-surface">
        <Image
          src={main.url}
          alt={main.alt || title}
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-cover"
        />
      </div>
      {images.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {images.slice(0, 6).map((img, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Afbeelding ${i + 1} tonen`}
              aria-current={i === active}
              className={`relative aspect-[4/5] w-16 shrink-0 overflow-hidden rounded-card border lg:w-20 ${
                i === active ? "border-ink" : "border-line hover:border-muted"
              }`}
            >
              <Image src={img.url} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
