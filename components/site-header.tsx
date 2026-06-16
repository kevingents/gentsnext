import Image from "next/image";
import Link from "next/link";
import { MegaMenuBar, MegaMenuMobile } from "@/components/mega-menu";
import { CartButton } from "@/components/cart/cart-button";
import { WishlistLink } from "@/components/wishlist/wishlist-link";
import { AnnouncementBar } from "@/components/announcement-bar";
import { SearchTrigger } from "@/components/search/search-trigger";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getLocale } from "@/lib/locale-server";
import { getMenu } from "@/lib/menu-server";
import type { MenuItem } from "@/lib/main-menu";

export async function SiteHeader() {
  const [locale, menu] = await Promise.all([getLocale(), getMenu()]);
  return (
    <>
      <AnnouncementBar />
      <SiteHeaderInner locale={locale} menu={menu} />
    </>
  );
}

function SiteHeaderInner({ locale, menu }: { locale: import("@/lib/i18n").Locale; menu: MenuItem[] }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/95 backdrop-blur">
      {/* Bovenrij: hamburger (mobiel) · logo · utilities */}
      <div className="relative mx-auto flex max-w-page items-center justify-between gap-4 px-gutter py-4">
        <div className="flex items-center gap-4 lg:flex-1">
          <div className="lg:hidden">
            <MegaMenuMobile items={menu} />
          </div>
        </div>

        <Link
          href="/"
          aria-label="GENTS — naar de homepage"
          className="shrink-0 lg:absolute lg:left-1/2 lg:-translate-x-1/2"
        >
          <Image
            src="/brand/brand-logo-zwart.png"
            alt="GENTS — Suits You"
            width={512}
            height={244}
            priority
            className="h-10 w-auto lg:h-11"
          />
        </Link>

        <div className="flex items-center gap-5 lg:flex-1 lg:justify-end">
          <Link
            href="/pak-samenstellen"
            className="hidden font-sans text-sm text-ink-soft transition-colors hover:text-ink lg:block"
          >
            Pak samenstellen
          </Link>
          <Link
            href="/pages/winkels"
            className="hidden font-sans text-sm text-ink-soft transition-colors hover:text-ink lg:block"
          >
            Winkels
          </Link>
          <LanguageSwitcher current={locale} />
          <SearchTrigger />
          <Link href="/account" aria-label="Mijn account" className="text-ink-soft transition-colors hover:text-ink">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" strokeLinecap="round" />
            </svg>
          </Link>
          <WishlistLink />
          <CartButton />
        </div>
      </div>

      {/* Onderrij: het volledige mega-menu (alleen desktop). */}
      <div className="hidden border-t border-line lg:block">
        <div className="mx-auto max-w-page px-gutter py-2.5">
          <MegaMenuBar items={menu} />
        </div>
      </div>
    </header>
  );
}
