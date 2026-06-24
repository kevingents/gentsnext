"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useT } from "@/components/i18n/locale-provider";

export type LookCard = { slug: string; title: string; occasion: string; theme?: string; image: string };

/**
 * Filterbare looks-overzicht: chips per gelegenheid én thema (bv. "Peaky Blinders").
 * "Alles" toont alle looks; een chip filtert op occasion OF theme.
 */
export function LooksGrid({ looks }: { looks: LookCard[] }) {
  const t = useT();
  const [filter, setFilter] = useState("");

  const { occasions, themes } = useMemo(() => {
    const occ = new Set<string>();
    const thm = new Set<string>();
    for (const l of looks) {
      if (l.occasion) occ.add(l.occasion);
      if (l.theme) thm.add(l.theme);
    }
    return { occasions: [...occ], themes: [...thm] };
  }, [looks]);

  const filtered = filter ? looks.filter((l) => l.occasion === filter || l.theme === filter) : looks;
  const hasTags = occasions.length + themes.length > 1;

  return (
    <>
      {hasTags ? (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Chip active={!filter} onClick={() => setFilter("")}>{t("looks.filter.all")}</Chip>
          {occasions.map((t) => (
            <Chip key={`o-${t}`} active={filter === t} onClick={() => setFilter(t)}>{t}</Chip>
          ))}
          {themes.length ? <span aria-hidden className="mx-1 h-5 w-px bg-line" /> : null}
          {themes.map((t) => (
            <Chip key={`t-${t}`} active={filter === t} onClick={() => setFilter(t)}>{t}</Chip>
          ))}
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((l) => (
          <Link key={l.slug} href={`/looks/${l.slug}`} className="group">
            <div className="relative aspect-[4/5] overflow-hidden rounded-card bg-surface">
              <Image src={l.image} alt={l.title} fill sizes="(max-width:1024px) 50vw, 33vw" className="object-cover transition duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/60 to-transparent" />
              <div className="absolute bottom-4 left-4">
                <p className="label-brand !text-canvas/80">{l.theme || l.occasion}</p>
                <p className="mt-1 font-display text-xl font-light text-canvas">{l.title}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {!filtered.length ? <p className="mt-8 font-sans text-sm text-muted">{t("looks.filter.noResults")}</p> : null}
    </>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-1.5 font-sans text-sm transition-colors ${active ? "border-ink bg-ink text-canvas" : "border-line text-ink-soft hover:border-ink hover:text-ink"}`}
    >
      {children}
    </button>
  );
}
