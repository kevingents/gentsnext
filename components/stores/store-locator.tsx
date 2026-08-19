"use client";

import { Link } from "@/components/i18n/link";
import { useMemo, useState } from "react";
import { Dot } from "@/components/icons";
import { useT } from "@/components/i18n/locale-provider";
import { MyStoreToggle } from "@/components/stores/my-store-toggle";
import { StoreChooser } from "@/components/stores/store-chooser";

export type LocatorStore = {
  pageHandle: string;
  title: string;
  city: string;
  address: string;
  phone: string;
  open: boolean;
  todayRange: string | null;
  /** Hemelsbrede afstand tot de bezoeker (km) — null als we die niet kennen. */
  distanceKm?: number | null;
};

export function StoreLocator({ stores, myStores = [] }: { stores: LocatorStore[]; myStores?: string[] }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  // Lokale echo: de serverprop (cookie) komt pas na de router-refresh mee.
  const [favorites, setFavorites] = useState<string[]>(myStores);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return stores
      .filter(
        (s) =>
          (!needle || `${s.city} ${s.title} ${s.address}`.toLowerCase().includes(needle)) &&
          (!openOnly || s.open)
      )
      /* Eigen winkels bovenaan — dat zijn de winkels waar je naartoe gaat. De
         server levert de rest al op afstand gesorteerd, dus die volgorde laten
         we staan (sort is stabiel). */
      .sort((a, b) => Number(favorites.includes(b.pageHandle)) - Number(favorites.includes(a.pageHandle)));
  }, [stores, q, openOnly, favorites]);

  const mine = stores.filter((s) => favorites.includes(s.pageHandle));

  return (
    <div>
      {/* Uitleg vóór de knop: "mijn winkel" is geen bladwijzer maar een filter op
          voorraad — zonder die zin blijft de ster een raadsel. */}
      <div className="mb-8 border border-line bg-surface px-4 py-3 font-sans text-sm">
        {mine.length ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-ink-soft">{mine.length === 1 ? t("myStore.locator.current") : t("myStore.locator.currentPlural")}</span>
            {mine.map((s, i) => (
              <span key={s.pageHandle}>
                {i > 0 ? <span className="text-muted">· </span> : null}
                <Link href={`/pages/${s.pageHandle}`} className="font-medium text-ink underline underline-offset-4">
                  {s.city}
                </Link>
              </span>
            ))}
            {/* Wisselen is hier de zinnige actie (wissen kan via de kaart zelf). */}
            <span className="ml-auto">
              <StoreChooser myStores={mine.map((s) => s.title)} variant="link" bron="winkels" />
            </span>
          </p>
        ) : (
          <p className="text-ink-soft">
            <span className="font-medium text-ink">{t("myStore.locator.pickTitle")}</span>{" "}
            {t("myStore.locator.pickBody")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("stores.locator.searchPlaceholder")}
          aria-label={t("stores.locator.searchAriaLabel")}
          className="w-full max-w-sm border border-line bg-canvas px-4 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
        />
        <label className="flex items-center gap-2 font-sans text-sm text-ink-soft">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} className="h-4 w-4 accent-ink" />
          {t("stores.locator.openOnly")}
        </label>
        <span className="font-sans text-sm text-muted sm:ml-auto">{filtered.length} {t("clickCollect.storePlural")}</span>
      </div>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((s) => {
          const isMine = favorites.includes(s.pageHandle);
          return (
            <li key={s.pageHandle}>
              {/* Kaart is bewust géén Link meer: er staat nu een knop in, en een
                  knop binnen een link is zowel ongeldig als onklikbaar. */}
              <div className={`flex h-full flex-col border p-5 transition-colors ${isMine ? "border-ink" : "border-line hover:border-ink"}`}>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-display text-lg">
                    <Link href={`/pages/${s.pageHandle}`} className="hover:underline underline-offset-4">{s.city}</Link>
                  </h2>
                  {s.open ? (
                    <span className="shrink-0 font-sans text-xs text-success"><Dot className="inline-block h-1.5 w-1.5" /> {t("stores.openNow")}</span>
                  ) : (
                    <span className="shrink-0 font-sans text-xs text-muted">{t("stores.closed")}</span>
                  )}
                </div>
                <p className="mt-1 font-sans text-sm text-ink-soft">
                  {s.address}
                  {typeof s.distanceKm === "number" ? (
                    <span className="text-muted"> · {t("myStore.km", { km: s.distanceKm })}</span>
                  ) : null}
                </p>
                {s.todayRange ? (
                  <p className="mt-2 font-sans text-xs text-muted">{t("stores.today")}: {s.todayRange}</p>
                ) : null}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
                  <MyStoreToggle
                    value={s.pageHandle}
                    active={isMine}
                    onChange={(list) => setFavorites(list.map((x) => x.pageHandle))}
                    variant="inline"
                    bron="winkels"
                  />
                  <Link href={`/pages/${s.pageHandle}`} className="font-sans text-sm text-ink underline underline-offset-4">
                    {t("stores.locator.viewStore")} →
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
