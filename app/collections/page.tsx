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
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold">Collecties</h1>
      <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {collections.map((c) => (
          <li key={c.id}>
            <Link
              href={`/collections/${c.handle}`}
              className="block rounded-lg bg-white p-4 text-sm font-medium shadow-card transition hover:shadow-md"
            >
              {c.title}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
