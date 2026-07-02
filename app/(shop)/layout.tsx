import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { HideOnCheckout } from "@/components/hide-on-checkout";
import { CartProvider } from "@/components/cart/cart-context";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { AddedToCartToast } from "@/components/cart/added-toast";
import { CartToast } from "@/components/cart/cart-toast";
import { WishlistProvider } from "@/components/wishlist/wishlist-context";
import { BackToTop } from "@/components/back-to-top";
import { CookieNotice } from "@/components/cookie-notice";
import { SkipLink } from "@/components/skip-link";
import { HelpButton } from "@/components/help-button";
import { WelcomePopup } from "@/components/welcome-popup";
import { Tracker } from "@/components/analytics/tracker";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { getLocale } from "@/lib/locale-server";
import { getUiMessages } from "@/lib/translate";

/** Winkel-layout: header, footer en winkelwagen rond alle storefront-pagina's. */
export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getUiMessages(locale).catch(() => undefined);
  return (
    <LocaleProvider locale={locale} messages={messages}>
    <CartProvider>
      <WishlistProvider>
        <div className="flex min-h-screen flex-col">
          <SkipLink />
          <SiteHeader />
          <main id="main" className="flex-1">{children}</main>
          <HideOnCheckout><SiteFooter /></HideOnCheckout>
          <CartDrawer />
          <AddedToCartToast />
          <CartToast />
          <BackToTop />
          <HelpButton />
          <CookieNotice />
          {/* Geen welkom-/kortingspopup op de checkout: afleiding vlak vóór betalen. */}
          <HideOnCheckout><WelcomePopup /></HideOnCheckout>
          <Tracker />
        </div>
      </WishlistProvider>
    </CartProvider>
    </LocaleProvider>
  );
}
