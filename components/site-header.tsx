import Image from "next/image";
import { Link } from "@/components/i18n/link";
import { MegaMenuBar, MegaMenuMobile } from "@/components/mega-menu";
import { HideOnCheckout } from "@/components/hide-on-checkout";
import { CartButton } from "@/components/cart/cart-button";
import { WishlistLink } from "@/components/wishlist/wishlist-link";
import { AnnouncementBar } from "@/components/announcement-bar";
import { SearchTrigger } from "@/components/search/search-trigger";
import { LanguageSwitcher } from "@/components/language-switcher";
import { TrackLink } from "@/components/analytics/track-link";
import { getLocale } from "@/lib/locale-server";
import { getLocalizedMenu, getLocalizedServiceLinks } from "@/lib/nav-i18n";
import { getT } from "@/lib/t-server";
import { getMyStoresFromCookie } from "@/lib/store-preference";
import type { MenuItem, MenuLink } from "@/lib/main-menu";

export async function SiteHeader() {
  const locale = await getLocale();
  // Vertaald menu (ns "nav" via de vertaal-cron) — het menu is portal-data en
  // lekte anders Nederlands op /en /de. De servicelinks onderin de drawer lopen
  // over dezelfde rail.
  const [menu, serviceLinks] = await Promise.all([getLocalizedMenu(locale), getLocalizedServiceLinks(locale)]);
  // Bewust de cookie-variant: de kop rendert op élke pagina, en getMyStores()
  // valt terug op het profiel — dat zou een DB-vraag per paginaweergave zijn.
  const mijn = await getMyStoresFromCookie();
  // Meer winkels? Dan de eerste + "+2": de kop is geen plek voor een lijstje.
  const myStoreCity = mijn.length ? (mijn.length === 1 ? mijn[0].city : `${mijn[0].city} +${mijn.length - 1}`) : null;
  return (
    <>
      {/* Checkout = afleidingsvrij: geen campagne-balk met exit-link. Op mobiel
          helemaal geen balk boven de header — daar is de eerste schermhoogte te
          kostbaar en duwde de balk het product onder de vouw. */}
      <HideOnCheckout>
        <div className="hidden lg:block">
          <AnnouncementBar />
        </div>
      </HideOnCheckout>
      <SiteHeaderInner locale={locale} menu={menu} serviceLinks={serviceLinks} myStoreCity={myStoreCity} />
    </>
  );
}

async function SiteHeaderInner({
  locale,
  menu,
  serviceLinks,
  myStoreCity,
}: {
  locale: import("@/lib/i18n").Locale;
  menu: MenuItem[];
  serviceLinks: MenuLink[];
  myStoreCity: string | null;
}) {
  const t = await getT(locale);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/95 backdrop-blur">
      {/* Bovenrij mobiel: hamburger · zoeken | logo | account · favorieten · tas.
          Beide zijgroepen zijn flex-1, dus het logo staat exact in het midden
          zonder absolute positionering (die overlapte op 320px-schermen). */}
      <div className="relative mx-auto flex max-w-page items-center justify-between gap-3 px-gutter py-4 lg:gap-4">
        <div className="flex flex-1 items-center gap-3 lg:gap-4">
          <div className="flex items-center gap-3 lg:hidden">
            {/* Op de checkout geen menu — logo (naar home) is de enige uitgang. */}
            <HideOnCheckout>
              <MegaMenuMobile items={menu} serviceLinks={serviceLinks} myStoreCity={myStoreCity} />
              <SearchTrigger />
            </HideOnCheckout>
          </div>
        </div>

        {/* De vaste kop-links meten we apart van het mega-menu (source "header"):
            het zijn andere uitgangen dan een kolomlink in een paneel. */}
        <TrackLink
          href="/"
          trackProps={{ source: "header", label: "logo" }}
          aria-label="GENTS — naar de homepage"
          className="shrink-0 lg:absolute lg:left-1/2 lg:-translate-x-1/2"
        >
          <Image
            src="/brand/brand-logo-zwart.png"
            alt="GENTS — Suits You"
            width={512}
            height={244}
            priority
            className="h-8 w-auto sm:h-10 lg:h-11"
          />
        </TrackLink>

        {/* Icoon-knoppen hebben een 44×44px tikvlak met -mx-2-compensatie; gap-4
            i.p.v. gap-5 houdt de zichtbare spatiëring gelijk zonder overlappende
            tikvlakken. */}
        <div className="flex flex-1 items-center justify-end gap-3 lg:gap-4">
          {/* Op de checkout géén utilities (zoeken/account/tas/menu) — focus. */}
          <HideOnCheckout>
            <TrackLink
              href="/pak-samenstellen"
              trackProps={{ source: "header", label: "pak-samenstellen" }}
              className="hidden font-sans text-sm text-ink-soft transition-colors hover:text-ink lg:block"
            >
              {t("nav.suitBuilder")}
            </TrackLink>
            <TrackLink
              href="/pages/winkels"
              trackProps={{ source: "header", label: "winkels" }}
              className="hidden font-sans text-sm text-ink-soft transition-colors hover:text-ink lg:block"
            >
              {t("nav.stores")}
              {/* Gekozen winkel meteen zichtbaar — anders is "mijn winkel" een
                  instelling die alleen bestaat op de plek waar je 'm zette. */}
              {myStoreCity ? <span className="text-muted"> · {myStoreCity}</span> : null}
            </TrackLink>
            {/* Taal blijft desktop-only; op mobiel staat de taalkiezer onderin de
                menu-drawer. Zoeken staat op mobiel links naast de hamburger. */}
            <div className="hidden lg:block">
              <LanguageSwitcher current={locale} />
            </div>
            <div className="hidden lg:block">
              <SearchTrigger />
            </div>
            <Link href="/account" aria-label="Mijn account" className="-mx-2 flex h-11 w-11 items-center justify-center text-ink-soft transition-colors hover:text-ink">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" strokeLinecap="round" />
              </svg>
            </Link>
            <WishlistLink />
            <CartButton />
          </HideOnCheckout>
        </div>
      </div>

      {/* Onderrij: het volledige mega-menu (alleen desktop; niet op de checkout — focus). */}
      <HideOnCheckout>
        <div className="hidden border-t border-line lg:block">
          <div className="mx-auto max-w-page px-gutter py-2.5">
            <MegaMenuBar items={menu} />
          </div>
        </div>
      </HideOnCheckout>
    </header>
  );
}
