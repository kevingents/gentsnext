import Image from "next/image";
import Link from "next/link";

/** Hoofdcategorieën — afgeleid van hoofdgroep_omschrijving in de catalogus. */
const NAV: { label: string; href: string }[] = [
  { label: "Pakken", href: "/collections/pakken" },
  { label: "Colberts", href: "/collections/colberts" },
  { label: "Pantalons", href: "/collections/broeken" },
  { label: "Overhemden", href: "/collections/overhemden" },
  { label: "Smoking", href: "/collections/smoking" },
  { label: "Accessoires", href: "/collections/accessoires" },
];

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
