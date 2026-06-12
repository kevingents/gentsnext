import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-navy-100 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="text-xl font-semibold tracking-[0.3em] text-navy">
          GENTS
        </Link>
        <nav className="flex items-center gap-6 text-sm text-slate">
          <Link href="/collections" className="hover:text-navy">
            Collecties
          </Link>
        </nav>
      </div>
    </header>
  );
}
