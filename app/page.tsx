import Link from "next/link";
import { listCollections } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function Home() {
  let collections: Awaited<ReturnType<typeof listCollections>> = [];
  let dbReady = true;
  try {
    collections = await listCollections();
  } catch {
    // Database nog niet gekoppeld/gevuld — toon de statusvariant.
    dbReady = false;
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-widest text-slate">
        GENTS Herenmode
      </p>
      <h1 className="mt-2 text-4xl font-semibold">Stijl voor elke gelegenheid</h1>

      {!dbReady ? (
        <p className="mt-6 max-w-xl text-slate">
          De catalogus-database is nog niet gekoppeld. Volg de Vercel-checklist
          in de README (Neon koppelen, migratie draaien, import starten) en
          deze pagina toont vanzelf de collecties.
        </p>
      ) : collections.length === 0 ? (
        <p className="mt-6 max-w-xl text-slate">
          De database is verbonden maar nog leeg. Draai{" "}
          <code className="rounded bg-white px-1 py-0.5">npm run import:cache</code> of{" "}
          <code className="rounded bg-white px-1 py-0.5">npm run import:shopify</code>{" "}
          om de catalogus te vullen.
        </p>
      ) : (
        <section className="mt-10">
          <h2 className="text-lg font-medium">Collecties</h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
        </section>
      )}
    </main>
  );
}
