import Image from "next/image";
import Link from "next/link";
import { MegaMenuBar, MegaMenuMobile } from "@/components/mega-menu";
import { CartButton } from "@/components/cart/cart-button";
import { WishlistLink } from "@/components/wishlist/wishlist-link";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/95 backdrop-blur">
      {/* Bovenrij: hamburger (mobiel) · logo · utilities */}
      <div className="relative mx-auto flex max-w-page items-center justify-between gap-4 px-gutter py-4">
        <div className="flex items-center gap-4 lg:flex-1">
          <div className="lg:hidden">
            <MegaMenuMobile />
          </div>
        </div>

        <Link
          href="/"
          aria-label="GENTS — naar de homepage"
          className="shrink-0 lg:absolute lg:left-1/2 lg:-translate-x-1/2"
        >
          <Image
            src="/brand/brand-logo-zwart.png"
            alt="GENTS"
            width={132}
            height={52}
            priority
            className="h-9 w-auto"
          />
        </Link>

        <div className="flex items-center gap-5 lg:flex-1 lg:justify-end">
          <Link
            href="/pak-samenstellen"
            className="hidden font-sans text-sm text-ink-soft transition-colors hover:text-ink sm:block"
          >
            Pak samenstellen
          </Link>
          <Link
            href="/maatadvies"
            className="hidden font-sans text-sm text-ink-soft transition-colors hover:text-ink sm:block"
          >
            Maatadvies
          </Link>
          <Link href="/zoeken" aria-label="Zoeken" className="text-ink-soft transition-colors hover:text-ink">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
            </svg>
          </Link>
          <WishlistLink />
          <CartButton />
        </div>
      </div>

      {/* Onderrij: het volledige mega-menu (alleen desktop). */}
      <div className="hidden border-t border-line lg:block">
        <div className="mx-auto max-w-page px-gutter py-2.5">
          <MegaMenuBar />
        </div>
      </div>
    </header>
  );
}
