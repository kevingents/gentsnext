import type { Metadata } from "next";
import { Source_Sans_3, Montserrat } from "next/font/google";
import { getSiteUrl } from "@/lib/site-url";
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

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "GENTS — Suits You", template: "%s | GENTS" },
  description:
    "GENTS is dé specialist voor je formele momenten. Pakken, overhemden, smoking en meer — betaalbare luxe voor elke gelegenheid.",
  robots: indexable ? undefined : { index: false, follow: false },
};

/**
 * Minimale root-layout (alleen html/body + fonts). De winkel-chrome
 * (header/footer/cart) zit in de (shop)-groep, zodat /studio schermvullend is.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${display.variable} ${body.variable}`}>
      <body className="bg-canvas font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
