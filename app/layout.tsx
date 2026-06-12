import type { Metadata } from "next";
import "./globals.css";

const indexable = process.env.SITE_INDEXABLE === "true";

export const metadata: Metadata = {
  title: { default: "GENTS Herenmode", template: "%s | GENTS" },
  description: "GENTS Herenmode — stijlvolle herenkleding en pakken.",
  // Veiligheidsnet: tot SITE_INDEXABLE=true expliciet gezet is, blijft de
  // site noindex. Dit staat ook op de launch-checklist in de README.
  robots: indexable ? undefined : { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body className="min-h-screen bg-cream font-sans text-navy antialiased">
        {children}
      </body>
    </html>
  );
}
