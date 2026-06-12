import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

const indexable = process.env.SITE_INDEXABLE === "true";
const siteUrl = process.env.PUBLIC_SITE_URL || "https://gents.nl";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "GENTS Herenmode", template: "%s | GENTS" },
  description: "GENTS Herenmode — stijlvolle herenkleding en pakken.",
  // Veiligheidsnet: tot SITE_INDEXABLE=true expliciet gezet is, blijft de
  // site noindex. Dit staat ook op de launch-checklist in de README.
  robots: indexable ? undefined : { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body className="flex min-h-screen flex-col bg-cream font-sans text-navy antialiased">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
