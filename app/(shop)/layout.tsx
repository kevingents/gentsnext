import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CartProvider } from "@/components/cart/cart-context";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { WishlistProvider } from "@/components/wishlist/wishlist-context";
import { BackToTop } from "@/components/back-to-top";

/** Winkel-layout: header, footer en winkelwagen rond alle storefront-pagina's. */
export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <WishlistProvider>
        <div className="flex min-h-screen flex-col">
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
          <CartDrawer />
          <BackToTop />
        </div>
      </WishlistProvider>
    </CartProvider>
  );
}
