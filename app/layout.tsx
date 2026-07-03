import type { Metadata } from "next";
import { Source_Sans_3, Montserrat } from "next/font/google";
import { getSiteUrl } from "@/lib/site-url";
import { getLocale } from "@/lib/locale-server";
import "./globals.css";

// Headers — open Adobe-successor van Myriad Pro (brandbook), lichte gewichten
// passen bij het dunne, elegante GENTS-woordmerk.
const display = Source_Sans_3({
  subsets: ["latin"],
  weight: ["300", "400", "600"],
  variable: "--font-display",
  display: "swap",
});

// Body — Montserrat (brandbook secundair).
const body = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

const indexable = process.env.SITE_INDEXABLE === "true";
const siteUrl = getSiteUrl();

const SITE_DESC =
  "GENTS is dé specialist voor je formele momenten. Pakken, overhemden, smoking en meer — betaalbare luxe voor elke gelegenheid.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "GENTS — Suits You", template: "%s | GENTS" },
  description: SITE_DESC,
  robots: indexable ? undefined : { index: false, follow: false },
  // Site-brede social-cards (per-pagina metadata overschrijft titel/omschrijving/
  // beeld). Het beeld komt automatisch uit app/opengraph-image.
  openGraph: {
    type: "website",
    siteName: "GENTS",
    title: "GENTS — Suits You",
    description: SITE_DESC,
    // Bewust GEEN vaste url hier: subpagina's die openGraph overschrijven (zonder eigen
    // url) zouden anders allemaal og:url=homepage erven → verkeerde social-attributie.
    // De homepage zet 'm expliciet; subpagina's krijgen 'm via hun eigen canonical-url.
  },
  twitter: {
    card: "summary_large_image",
    title: "GENTS — Suits You",
    description: SITE_DESC,
  },
};

/**
 * Minimale root-layout (alleen html/body + fonts). De winkel-chrome
 * (header/footer/cart) zit in de (shop)-groep, zodat /studio schermvullend is.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${display.variable} ${body.variable}`}>
      <body className="bg-canvas font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
