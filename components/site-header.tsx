import Image from "next/image";
import Link from "next/link";
import { NAV_CATEGORIES } from "@/lib/categories";

/** Hoofdcategorieën — volledige listings op hoofdgroep (/categorie/<slug>). */
const NAV = NAV_CATEGORIES.map((c) => ({ label: c.label, href: `/categorie/${c.slug}` }));

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/95 backdrop-blur">
      <div className="mx-auto flex max-w-page items-center justify-between px-gutter py-4">
        <Link href="/" aria-label="GENTS — naar de homepage" className="shrink-0">
          <Image
            src="/brand/brand-logo-zwart.png"
            alt="GENTS"
            width={132}
            height={52}
            priority
            className="h-9 w-auto"
          />
        </Link>

        <nav aria-label="Hoofdmenu" className="hidden items-center gap-8 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="font-sans text-sm text-ink-soft transition-colors hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-5">
          <Link
            href="/pak-samenstellen"
            className="hidden font-sans text-sm text-ink-soft transition-colors hover:text-ink sm:block"
          >
            Pak samenstellen
          </Link>
          <Link
            href="/winkelwagen"
            className="font-sans text-sm text-ink-soft transition-colors hover:text-ink"
          >
            Winkelwagen
          </Link>
        </div>
      </div>
    </header>
  );
}
