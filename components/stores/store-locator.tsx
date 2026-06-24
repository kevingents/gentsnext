"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useT } from "@/components/i18n/locale-provider";

export type LocatorStore = {
  pageHandle: string;
  title: string;
  city: string;
  address: string;
  phone: string;
  open: boolean;
  todayRange: string | null;
};

export function StoreLocator({ stores }: { stores: LocatorStore[] }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [openOnly, setOpenOnly] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return stores.filter(
      (s) =>
        (!needle || `${s.city} ${s.title} ${s.address}`.toLowerCase().includes(needle)) &&
        (!openOnly || s.open)
    );
  }, [stores, q, openOnly]);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Zoek op stad of adres…"
          aria-label="Zoek een winkel"
          className="w-full max-w-sm border border-line bg-canvas px-4 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
        />
        <label className="flex items-center gap-2 font-sans text-sm text-ink-soft">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} className="h-4 w-4 accent-ink" />
          Alleen nu geopend
        </label>
        <span className="font-sans text-sm text-muted sm:ml-auto">{filtered.length} {t("clickCollect.storePlural")}</span>
      </div>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((s) => (
          <li key={s.pageHandle}>
            <Link
              href={`/pages/${s.pageHandle}`}
              className="flex h-full flex-col border border-line p-5 transition-colors hover:border-ink"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-display text-lg">{s.city}</h2>
                {s.open ? (
                  <span className="shrink-0 font-sans text-xs text-success">● Nu open</span>
                ) : (
                  <span className="shrink-0 font-sans text-xs text-muted">Gesloten</span>
                )}
              </div>
              <p className="mt-1 font-sans text-sm text-ink-soft">{s.address}</p>
              {s.todayRange ? (
                <p className="mt-2 font-sans text-xs text-muted">Vandaag: {s.todayRange}</p>
              ) : null}
              <span className="mt-auto pt-4 font-sans text-sm text-ink underline underline-offset-4">
                Bekijk winkel →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
