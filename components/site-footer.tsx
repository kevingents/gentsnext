import Image from "next/image";
import Link from "next/link";
import { NewsletterSignup } from "@/components/newsletter-signup";

const COLS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Shoppen",
    links: [
      { label: "Pakken", href: "/categorie/pakken" },
      { label: "Overhemden", href: "/categorie/overhemden" },
      { label: "Pak samenstellen", href: "/pak-samenstellen" },
      { label: "Favorieten", href: "/favorieten" },
      { label: "Alle collecties", href: "/collections" },
    ],
  },
  {
    title: "Juridisch",
    links: [
      { label: "Algemene voorwaarden", href: "/pages/algemene-voorwaarden" },
      { label: "Privacyverklaring", href: "/pages/privacyverklaring" },
      { label: "Cookies", href: "/pages/cookies" },
    ],
  },
  {
    title: "Service",
    links: [
      { label: "Klantenservice", href: "/pages/service" },
      { label: "Maatadvies", href: "/maatadvies" },
      { label: "Bezorging & levertijd", href: "/pages/bezorgkosten-levertijden" },
      { label: "Retourneren", href: "/pages/retourneren" },
      { label: "Onze winkels", href: "/pages/winkels" },
    ],
  },
  {
    title: "GENTS",
    links: [
      { label: "Over GENTS", href: "/pages/over-gents" },
      { label: "Etiquette & dresscodes", href: "/pages/etiquette" },
      { label: "Trouwen met GENTS", href: "/pages/trouwen-met-gents" },
      { label: "Werken bij GENTS", href: "/pages/werken-bij-gents" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 bg-ink text-canvas">
      {/* Nieuwsbrief-blok */}
      <div className="border-b border-canvas/15">
        <div className="mx-auto grid max-w-page items-center gap-6 px-gutter py-10 md:grid-cols-2">
          <div>
            <p className="label-brand !text-canvas/60">GENTS Insider</p>
            <h2 className="mt-2 font-display text-2xl font-light text-canvas">
              Nieuwe collecties, styling-tips en exclusieve aanbiedingen
            </h2>
            <p className="mt-1 font-sans text-sm text-canvas/70">
              Schrijf je in en mis nooit meer een lancering of sale.
            </p>
          </div>
          <NewsletterSignup />
        </div>
      </div>

      <div className="mx-auto max-w-page px-gutter py-14">
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-[1.6fr_repeat(4,1fr)]">
          <div>
            <Image
              src="/brand/brand-logo-wit.png"
              alt="GENTS"
              width={140}
              height={56}
              className="h-10 w-auto"
            />
            <p className="mt-4 max-w-xs font-sans text-sm leading-relaxed text-canvas/70">
              Dé specialist voor je formele momenten. Betaalbare luxe, persoonlijk
              advies — online en in onze winkels.
            </p>
          </div>
          {COLS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="label-brand !text-canvas/60">{col.title}</p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="font-sans text-sm text-canvas/80 transition-colors hover:text-canvas"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 border-t border-canvas/15 pt-6">
          <p className="font-sans text-xs text-canvas/50">
            © {new Date().getFullYear()} GENTS — Suits You. Alle prijzen incl. btw.
          </p>
        </div>
      </div>
    </footer>
  );
}
