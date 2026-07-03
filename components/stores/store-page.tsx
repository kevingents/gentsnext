import Link from "next/link";
import { Dot } from "@/components/icons";
import { DAYS, openStatus, mapsEmbedUrl, mapsLinkUrl, type Store } from "@/lib/stores";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/messages";

export async function StorePage({ store }: { store: Store }) {
  const { open, today, todayRange } = openStatus(store);
  const todayName = today;
  const locale = await getLocale();

  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <nav className="font-sans text-sm text-muted" aria-label={t("common.breadcrumb", locale)}>
        <Link href="/" className="hover:text-ink">{t("common.home", locale)}</Link>
        {" / "}
        <Link href="/pages/winkels" className="hover:text-ink">{t("nav.stores", locale)}</Link>
        {" / "}
        <span className="text-ink">{store.city}</span>
      </nav>

      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <div>
          <p className="label-brand">{t("stores.page.eyebrow", locale)}</p>
          <h1 className="mt-2 text-display-lg">{store.city}</h1>
          <p className="mt-1 font-sans text-sm">
            {open ? <span className="text-success"><Dot className="inline-block h-[7px] w-[7px]" /> {t("stores.openNow", locale)}</span> : <span className="text-muted">{t("stores.page.closedNow", locale)}</span>}
            {todayRange ? <span className="text-muted"> · {t("stores.page.todayPrefix", locale)} {todayRange}</span> : null}
          </p>

          <div className="mt-6 space-y-1 font-sans text-sm text-ink-soft">
            <p className="font-medium text-ink">{t("stores.page.address", locale)}</p>
            <p>{store.address}</p>
            <p>{store.city}</p>
          </div>

          {store.phone ? (
            <p className="mt-4 font-sans text-sm">
              <span className="font-medium">{t("stores.page.phone", locale)}: </span>
              <a href={`tel:${store.phone.replace(/\s/g, "")}`} className="text-ink underline underline-offset-4">
                {store.phone}
              </a>
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-3">
            <a href={mapsLinkUrl(store)} target="_blank" rel="noopener noreferrer" className="btn-primary">
              {t("stores.page.planRoute", locale)}
            </a>
            <Link href="/pages/trouw-afspraak" className="btn-ghost">
              {t("stores.page.makeAppointment", locale)}
            </Link>
          </div>

          {/* Openingstijden */}
          <div className="mt-8">
            <p className="label-brand mb-3">{t("stores.page.openingHours", locale)}</p>
            <dl className="divide-y divide-line border-y border-line">
              {DAYS.map((day) => {
                const range = store.hours[day]?.trim();
                const isToday = day === todayName;
                return (
                  <div key={day} className={`flex justify-between py-2 font-sans text-sm ${isToday ? "font-medium text-ink" : "text-ink-soft"}`}>
                    <dt className="capitalize">{day}</dt>
                    <dd>{range || t("stores.closed", locale)}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </div>

        {/* Kaart */}
        <div className="min-h-[360px] overflow-hidden rounded-card border border-line bg-surface">
          <iframe
            title={t("stores.page.mapTitle", locale, { city: store.city })}
            src={mapsEmbedUrl(store)}
            className="h-full min-h-[360px] w-full"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </div>
    </div>
  );
}
