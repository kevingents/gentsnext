import type { Metadata } from "next";
import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { searchProducts, suggestCorrection } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Zoeken",
  alternates: { canonical: "/zoeken" },
};

type Props = { searchParams: Promise<{ q?: string; cat?: string; size?: string; exact?: string }> };

export default async function ZoekenPage({ searchParams }: Props) {
  const sp = await searchParams;
  const query = String(sp.q || "").trim();
  const cat = String(sp.cat || "").trim();
  const size = String(sp.size || "").trim();
  const exact = sp.exact === "1";

  // Basis-resultaten (zonder facet) → facet-opties; gefilterde resultaten → grid.
  let base = query ? await searchProducts(query, 100) : [];

  // "Bedoelde je …?" — bij weinig/geen resultaten een correctie zoeken.
  let didYouMean: string | null = null;
  let autoCorrected = false;
  if (query && base.length < 3 && !exact) {
    const correction = await suggestCorrection(query);
    if (correction) {
      const altBase = await searchProducts(correction, 100);
      if (altBase.length > base.length) {
        didYouMean = correction;
        if (base.length === 0) {
          // Geen resultaten → toon meteen de correctie (zoals Google/Doofinder).
          base = altBase;
          autoCorrected = true;
        }
      }
    }
  }
  const effectiveQuery = autoCorrected && didYouMean ? didYouMean : query;
  const results = query
    ? cat || size
      ? await searchProducts(effectiveQuery, 48, { category: cat || undefined, sizeLabels: size ? [size] : undefined })
      : base.slice(0, 48)
    : [];

  // Facet-opties uit de basisresultaten.
  const catCounts = new Map<string, number>();
  const sizeSet = new Set<string>();
  for (const r of base) {
    if (r.category) catCounts.set(r.category, (catCounts.get(r.category) ?? 0) + 1);
    for (const s of r.availableSizes || []) sizeSet.add(s);
  }
  const cats = [...catCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const sizes = [...sizeSet];

  const qParam = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ q: query, ...(cat && !("cat" in extra) ? { cat } : {}), ...(size && !("size" in extra) ? { size } : {}), ...extra });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/zoeken?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-page px-gutter py-10">
      <p className="label-brand">Zoeken</p>
      <h1 className="mt-2 text-display-md">
        {query ? `Resultaten voor "${autoCorrected && didYouMean ? didYouMean : query}"` : "Wat zoek je?"}
      </h1>
      {autoCorrected && didYouMean ? (
        <p className="mt-2 font-sans text-sm text-muted">
          In plaats van <em>{query}</em>.{" "}
          <Link href={`/zoeken?q=${encodeURIComponent(query)}&exact=1`} className="text-ink underline underline-offset-4">
            Toch zoeken op "{query}"
          </Link>
        </p>
      ) : didYouMean ? (
        <p className="mt-2 font-sans text-sm">
          Bedoelde je{" "}
          <Link href={`/zoeken?q=${encodeURIComponent(didYouMean)}`} className="text-ink underline underline-offset-4">
            {didYouMean}
          </Link>
          ?
        </p>
      ) : null}

      <form action="/zoeken" method="get" className="mt-6 flex max-w-xl gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Zoek op pak, kleur, maat (bv. overhemd 42) of merk…"
          aria-label="Zoekterm"
          className="w-full border border-line bg-canvas px-4 py-3 font-sans text-sm focus:border-ink focus:outline-none"
        />
        <button type="submit" className="btn-primary">Zoeken</button>
      </form>

      {query ? (
        base.length > 0 ? (
          <>
            {/* Facetten in de zoekfunctie zelf */}
            <div className="mt-8 space-y-3">
              {cats.length > 1 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-sans text-xs uppercase tracking-wide text-muted">Categorie</span>
                  {cat ? (
                    <Link href={qParam({ cat: "" })} className="border border-ink bg-ink px-3 py-1 font-sans text-xs text-canvas">{cat} ✕</Link>
                  ) : null}
                  {cats.filter(([c]) => c !== cat).map(([c, n]) => (
                    <Link key={c} href={qParam({ cat: c })} className="border border-line px-3 py-1 font-sans text-xs hover:border-ink">
                      {c} <span className="text-muted">{n}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
              {sizes.length > 1 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-sans text-xs uppercase tracking-wide text-muted">Maat</span>
                  {size ? (
                    <Link href={qParam({ size: "" })} className="border border-ink bg-ink px-3 py-1 font-sans text-xs text-canvas">{size} ✕</Link>
                  ) : null}
                  {sizes.filter((s) => s !== size).slice(0, 16).map((s) => (
                    <Link key={s} href={qParam({ size: s })} className="border border-line px-3 py-1 font-sans text-xs hover:border-ink">{s}</Link>
                  ))}
                </div>
              ) : null}
            </div>

            <p className="mt-6 font-sans text-sm text-muted">{results.length} artikelen</p>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
              {results.map((p, i) => (
                <ProductCard key={p.id} product={p} priority={i < 8} />
              ))}
            </div>
          </>
        ) : (
          <div className="mt-10 max-w-xl">
            <p className="font-sans text-ink-soft">
              Geen artikelen gevonden voor <strong>{query}</strong>. Probeer een andere zoekterm of ontdek onze populaire categorieën.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {["pakken", "overhemden", "stropdassen", "smoking", "schoenen"].map((c) => (
                <li key={c}>
                  <Link href={`/collections/${c}`} className="border border-line bg-canvas px-4 py-2 font-sans text-sm transition-colors hover:border-ink">
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
