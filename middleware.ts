import { NextRequest, NextResponse } from "next/server";

/**
 * Legacy-URL-afhandeling uit het Shopify-tijdperk (zie SEO-exitstrategie):
 * Shopify genereert collectie-gebonden product-URL's
 * (/collections/<x>/products/<handle>) die breed gecrawld en gelinkt zijn.
 * Die krijgen hier een permanente redirect naar de canonieke product-URL.
 * Meer regels (cart-permalinks, /account/*, /policies/*) volgen bij de
 * checkout/content-fases.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const collectionProduct = pathname.match(/^\/collections\/[^/]+\/products\/([^/]+)\/?$/);
  if (collectionProduct) {
    const url = request.nextUrl.clone();
    url.pathname = `/products/${collectionProduct[1]}`;
    // Querystring behouden (UTM-parameters op oude ad-links); de PDP-canonical
    // vangt ?variant= al af.
    return NextResponse.redirect(url, 301);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/collections/:path*"],
};
