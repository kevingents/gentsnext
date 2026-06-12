import Image from "next/image";
import Link from "next/link";

const COLS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Shoppen",
    links: [
      { label: "Pakken", href: "/categorie/pakken" },
      { label: "Overhemden", href: "/categorie/overhemden" },
      { label: "Pak samenstellen", href: "/pak-samenstellen" },
      { label: "Alle collecties", href: "/collections" },
    ],
  },
  {
    title: "Service",
    links: [
      { label: "Maatadvies", href: "/maatadvies" },
      { label: "Winkels", href: "/winkels" },
      { label: "Retourneren", href: "/retourneren" },
      { label: "Veelgestelde vragen", href: "/faq" },
    ],
  },
  {
    title: "GENTS",
    links: [
      { label: "Over GENTS", href: "/over-gents" },
      { label: "Dresscode-hulp", href: "/dresscode" },
      { label: "Contact", href: "/contact" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 bg-ink text-canvas">
      <div className="mx-auto max-w-page px-gutter py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
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
