import Link from "next/link";

/** Gedeelde "binnenkort beschikbaar"-weergave. */
export function Soon({ title, intro }: { title: string; intro: string }) {
  return (
    <div className="max-w-xl">
      <p className="label-brand">Binnenkort</p>
      <h1 className="mt-2 text-display-md">{title}</h1>
      <p className="mt-4 font-sans text-ink-soft">{intro}</p>
      <Link href="/" className="btn-ghost mt-8">
        Terug naar home
      </Link>
    </div>
  );
}
