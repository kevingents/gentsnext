import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SmokingBuilder } from "@/components/smoking/smoking-builder";
import { getSmokingPakket } from "@/lib/smoking-pakket";

/**
 * "Smoking compleet" — de klant stelt zelf jas, pantalon, overhemd en strik
 * samen, elk in zijn eigen maat, tegen één vaste pakketprijs.
 *
 * Dynamisch en niet statisch gegenereerd: de pagina toont maten en voorraad,
 * en een uitverkochte maat die uit een cache komt is erger dan een pagina die
 * een halve seconde later laadt.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Smoking compleet samenstellen",
  description:
    "Stel je eigen smoking samen: kies je stof, je revers, je overhemd en je strik — elk in je eigen maat, voor één vaste prijs.",
  alternates: { canonical: "/smoking-samenstellen" },
};

export default async function SmokingSamenstellenPage() {
  const pakket = await getSmokingPakket();
  /* Geen bruikbaar pakket (uitgezet in het beheer, of niets op voorraad) →
     404 in plaats van een lege pagina met een dode knop. */
  if (!pakket) notFound();

  return (
    <div className="mx-auto max-w-page px-gutter py-8 pb-20">
      <nav className="font-sans text-sm text-muted" aria-label="Kruimelpad">
        <Link href="/" className="hover:text-ink">
          Home
        </Link>
        {" / "}
        <Link href="/collections/smoking" className="hover:text-ink">
          Smoking
        </Link>
        {" / "}
        <span className="text-ink">Samenstellen</span>
      </nav>

      <header className="mt-6 max-w-2xl">
        <h1 className="text-3xl font-semibold sm:text-4xl">{pakket.heading || "Stel je smoking samen"}</h1>
        {pakket.intro && <p className="mt-3 font-sans text-base text-muted">{pakket.intro}</p>}
      </header>

      <div className="mt-8">
        <SmokingBuilder pakket={pakket} />
      </div>
    </div>
  );
}
