import type { Metadata } from "next";
import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { searchProducts } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Zoeken",
  alternates: { canonical: "/zoeken" },
};

type Props = { searchParams: Promise<{ q?: string }> };

export default async function ZoekenPage({ searchParams }: Props) {
  const { q = "" } = await searchParams;
  const query = String(q).trim();
  const results = query ? await searchProducts(query, 48) : [];

  return (
    <div className="mx-auto max-w-page px-gutter py-10">
      <p className="label-brand">Zoeken</p>
      <h1 className="mt-2 text-display-md">
        {query ? `Resultaten voor "${query}"` : "Wat zoek je?"}
      </h1>

      <form action="/zoeken" method="get" className="mt-6 flex max-w-xl gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Zoek op pak, kleur, merk of categorie…"
          aria-label="Zoekterm"
          autoFocus
          className="w-full border border-line bg-canvas px-4 py-3 font-sans text-sm focus:border-ink focus:outline-none"
        />
        <button type="submit" className="btn-primary">Zoeken</button>
      </form>

      {query ? (
        results.length > 0 ? (
          <>
            <p className="mt-8 font-sans text-sm text-muted">{results.length}+ artikelen</p>
            <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
              {results.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </>
        ) : (
          <div className="mt-10 max-w-xl">
            <p className="font-sans text-ink-soft">
              Geen artikelen gevonden voor <strong>{query}</strong>. Probeer een
              andere zoekterm of ontdek onze populaire categorieën.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {["pakken", "overhemden", "stropdassen", "smoking", "schoenen"].map((c) => (
                <li key={c}>
                  <Link
                    href={`/collections/${c}`}
                    className="border border-line bg-canvas px-4 py-2 font-sans text-sm transition-colors hover:border-ink"
                  >
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}
    </div>
  );
}
