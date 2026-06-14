import Image from "next/image";
import Link from "next/link";
import { NewsletterSignup } from "@/components/newsletter-signup";
import { FooterPayments } from "@/components/footer-payments";
import { CookieSettingsLink } from "@/components/cookie-settings-link";
import { getFooter } from "@/lib/footer-server";

export async function SiteFooter() {
  const { intro, columns } = await getFooter();
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
              {intro}
            </p>
          </div>
          {columns.map((col) => (
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
        <div className="mt-12 space-y-2 border-t border-canvas/15 pt-6">
          <p className="font-sans text-xs text-canvas/55">
            GENTS B.V. · Lemelerbergweg 15, 1101 AJ Amsterdam · KvK 50187465
            {process.env.GENTS_VAT ? ` · BTW ${process.env.GENTS_VAT}` : ""}
            {" · "}
            <CookieSettingsLink className="underline hover:text-canvas/80" />
          </p>
          <p className="font-sans text-xs text-canvas/45">
            © {new Date().getFullYear()} GENTS — Suits You. Alle prijzen incl. btw. Een geschil los je samen op; lukt dat niet, dan kun je terecht bij de{" "}
            <a href="https://www.sgc.nl" target="_blank" rel="noopener noreferrer" className="underline hover:text-canvas/80">Geschillencommissie Thuiswinkel</a>{" "}
            of het{" "}
            <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer" className="underline hover:text-canvas/80">EU ODR-platform</a>.
          </p>
        </div>
      </div>
      <div className="border-t border-canvas/10">
        <FooterPayments />
      </div>
    </footer>
  );
}
