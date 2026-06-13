import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, PATH_HEADER, isLocale, type Locale } from "@/lib/i18n";

/**
 * Centrale locale-resolver + legacy-redirects.
 *
 * Fase 2 meertalig: niet-Nederlandse talen krijgen een URL-prefix (/en/…, /de/…).
 * Default (nl) blijft prefix-loos — bestaande Nederlandse URL's en SEO ongemoeid.
 * Voor een geprefixte URL rewriten we intern naar het prefix-loze pad (de
 * route-bestanden zijn ongeprefixt) en zetten we de locale in een request-header
 * (leidend voor getLocale) + een cookie (browse-persistentie op prefix-loze links).
 *
 * Legacy (Shopify-tijdperk): /collections/<x>/products/<handle> → /products/<handle>,
 * met behoud van een eventueel locale-prefix.
 */
export function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const pathname = url.pathname;
  const seg = pathname.split("/")[1] || "";

  let locale: Locale = DEFAULT_LOCALE;
  let path = pathname; // canoniek pad zonder locale-prefix
  let prefixed = false;

  if (isLocale(seg)) {
    if (seg === DEFAULT_LOCALE) {
      // /nl/… → 301 naar prefix-loos (geen dubbele content voor de defaulttaal).
      const to = url.clone();
      to.pathname = pathname.slice(seg.length + 1) || "/";
      return NextResponse.redirect(to, 301);
    }
    locale = seg;
    const rest = pathname.slice(seg.length + 1);
    path = rest.startsWith("/") ? rest : `/${rest}`;
    if (path === "") path = "/";
    prefixed = true;
  } else {
    const cookie = request.cookies.get(LOCALE_COOKIE)?.value || "";
    if (isLocale(cookie)) locale = cookie;
  }

  // Legacy collectie-product-URL → canonieke product-URL (locale-prefix behouden).
  const legacy = path.match(/^\/collections\/[^/]+\/products\/([^/]+)\/?$/);
  if (legacy) {
    const to = url.clone();
    to.pathname = (prefixed ? `/${locale}` : "") + `/products/${legacy[1]}`;
    return NextResponse.redirect(to, 301);
  }

  // Server-componenten de locale + het canonieke pad meegeven.
  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, locale);
  headers.set(PATH_HEADER, path);

  if (prefixed) {
    const to = url.clone();
    to.pathname = path;
    const res = NextResponse.rewrite(to, { request: { headers } });
    res.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return res;
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Alle pagina's, behalve API, Next-interne assets, Sanity Studio en bestanden (met punt).
  matcher: ["/((?!api|_next|studio|.*\\.).*)"],
};
