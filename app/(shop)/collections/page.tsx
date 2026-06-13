import type { Metadata } from "next";
import Link from "next/link";
import { listCollections } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Collecties",
  alternates: { canonical: "/collections" },
};

export default async function CollectionsPage() {
  const collections = await listCollections();

  return (
    <div className="mx-auto max-w-page px-gutter py-14">
      <p className="label-brand">Het assortiment</p>
      <h1 className="mt-2 text-display-md">Alle collecties</h1>
      <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {collections.map((c) => (
          <li key={c.id}>
            <Link
              href={`/collections/${c.handle}`}
              className="flex items-center justify-between border border-line bg-canvas px-5 py-4 font-sans text-sm transition-colors hover:border-ink"
            >
              <span>{c.title}</span>
              <span aria-hidden className="text-muted">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
