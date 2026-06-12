import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/product-card";
import { getCollectionByHandle, getCollectionProducts } from "@/lib/catalog";

export const dynamic = "force-dynamic";

const PER_PAGE = 24;

type Props = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { handle } = await params;
  const { page } = await searchParams;
  const collection = await getCollectionByHandle(handle);
  if (!collection) return {};
  const pageNum = Math.max(1, Math.floor(Number(page)) || 1);
  return {
    title: collection.seoTitle || collection.title,
    description: collection.seoDescription || undefined,
    // Eigen canonical per pagina — paginering NIET naar pagina 1 canonicaliseren.
    alternates: {
      canonical: pageNum > 1 ? `/collections/${handle}?page=${pageNum}` : `/collections/${handle}`,
    },
  };
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const { handle } = await params;
  const { page } = await searchParams;
  const collection = await getCollectionByHandle(handle);
  if (!collection) notFound();

  const pageNum = Math.max(1, Math.floor(Number(page)) || 1);
  const { items, total } = await getCollectionProducts(collection.id, pageNum, PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (pageNum > totalPages) notFound();

  return (
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold">{collection.title}</h1>
      <p className="mt-1 text-sm text-slate">
        {total} {total === 1 ? "artikel" : "artikelen"}
      </p>

      {items.length === 0 ? (
        <p className="mt-8 text-slate">Geen artikelen in deze collectie.</p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <nav className="mt-10 flex items-center justify-center gap-4 text-sm" aria-label="Paginering">
          {pageNum > 1 ? (
            <Link
              className="rounded bg-white px-4 py-2 shadow-card hover:shadow-md"
              href={`/collections/${handle}${pageNum - 1 > 1 ? `?page=${pageNum - 1}` : ""}`}
            >
              Vorige
            </Link>
          ) : null}
          <span className="text-slate">
            Pagina {pageNum} van {totalPages}
          </span>
          {pageNum < totalPages ? (
            <Link
              className="rounded bg-white px-4 py-2 shadow-card hover:shadow-md"
              href={`/collections/${handle}?page=${pageNum + 1}`}
            >
              Volgende
            </Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
