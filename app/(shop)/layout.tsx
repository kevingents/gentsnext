import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CartProvider } from "@/components/cart/cart-context";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { WishlistProvider } from "@/components/wishlist/wishlist-context";
import { BackToTop } from "@/components/back-to-top";
import { CookieNotice } from "@/components/cookie-notice";
import { SkipLink } from "@/components/skip-link";
import { HelpButton } from "@/components/help-button";
import { WelcomePopup } from "@/components/welcome-popup";
import { Tracker } from "@/components/analytics/tracker";

/** Winkel-layout: header, footer en winkelwagen rond alle storefront-pagina's. */
export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <WishlistProvider>
        <div className="flex min-h-screen flex-col">
          <SkipLink />
          <SiteHeader />
          <main id="main" className="flex-1">{children}</main>
          <SiteFooter />
          <CartDrawer />
          <BackToTop />
          <HelpButton />
          <CookieNotice />
          <WelcomePopup />
          <Tracker />
        </div>
      </WishlistProvider>
    </CartProvider>
  );
}
