import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-gutter py-24 text-center">
      <p className="label-brand">404</p>
      <h1 className="mt-2 text-display-lg">Pagina niet gevonden</h1>
      <p className="mt-4 font-sans text-ink-soft">
        De pagina die je zoekt bestaat niet meer of is verplaatst. Geen zorgen — we
        helpen je graag verder.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn-primary">Naar home</Link>
        <Link href="/collections/pakken" className="btn-ghost">Shop pakken</Link>
      </div>
      <div className="mt-12 text-left">
        <p className="label-brand">Populair</p>
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            { label: "Pakken", href: "/collections/pakken" },
            { label: "Overhemden", href: "/collections/overhemden" },
            { label: "Smoking", href: "/collections/smoking" },
            { label: "Stropdassen", href: "/collections/stropdassen" },
            { label: "Pak samenstellen", href: "/pak-samenstellen" },
            { label: "Maatadvies", href: "/maatadvies" },
          ].map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="block border border-line bg-canvas px-4 py-3 text-left font-sans text-sm transition-colors hover:border-ink">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
