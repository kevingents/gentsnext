import type { Metadata } from "next";
import { Link } from "@/components/i18n/link";
import { notFound } from "next/navigation";
import { SmokingBuilder } from "@/components/smoking/smoking-builder";
import { SmokingLook } from "@/components/smoking/smoking-look";
import { getSmokingPakket } from "@/lib/smoking-pakket";
import { pageMetadata } from "@/lib/page-meta-i18n";

/**
 * "Smoking compleet" — de klant stelt zelf jas, pantalon, overhemd en strik
 * samen, elk in zijn eigen maat, tegen één vaste pakketprijs.
 *
 * Dynamisch en niet statisch gegenereerd: de pagina toont maten en voorraad,
 * en een uitverkochte maat die uit een cache komt is erger dan een pagina die
 * een halve seconde later laadt.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata("/smoking-samenstellen");
}

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

      {/* Verdwijnt vanzelf als de generator uitstaat of de sleutel ontbreekt. */}
      <SmokingLook
        smokingNaam="smokingjas"
        kledingUrl={pakket.niveaus[0]?.rollen.find((r) => r.rol === "jas")?.opties[0]?.image}
      />

      <section className="mt-16 grid gap-6 border-t border-line pt-10 sm:grid-cols-3">
        {[
          {
            k: "Elk deel je eigen maat",
            v: "Een jas 52 met een broek 50 is doodnormaal. Je kiest per onderdeel, niet één maat voor alles.",
          },
          {
            k: "Vaste prijs, vrije keuze",
            v: "Welke revers, welk overhemd en welke strik je ook kiest binnen je stof — de pakketprijs verandert niet.",
          },
          {
            k: "Passen in de winkel",
            v: "Alles komt als losse artikelen binnen, dus ruilen of een maat wisselen doe je gewoon in een van onze winkels.",
          },
        ].map((b) => (
          <div key={b.k}>
            <h3 className="font-sans text-sm font-semibold">{b.k}</h3>
            <p className="mt-1.5 font-sans text-sm leading-relaxed text-muted">{b.v}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
