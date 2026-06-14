import type { Metadata } from "next";
import Link from "next/link";
import { BrandedState } from "@/components/brand-state";

export const metadata: Metadata = { title: "Nieuwsbrief bevestigd", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ status?: string }> };

export default async function NieuwsbriefBevestigdPage({ searchParams }: Props) {
  const { status } = await searchParams;
  const invalid = status === "ongeldig";

  if (invalid) {
    return (
      <BrandedState
        eyebrow="Nieuwsbrief"
        title="Deze link is verlopen of ongeldig"
        intro="Schrijf je gerust opnieuw in onderaan de site — dan sturen we je een nieuwe bevestigingslink."
      >
        <Link href="/" className="btn-primary">Terug naar home</Link>
      </BrandedState>
    );
  }

  return (
    <BrandedState
      eyebrow="Welkom bij de GENTS Insider"
      title="Je inschrijving is bevestigd"
      intro="Je staat erbij. Je ontvangt als eerste onze nieuwe collecties, styling-tips en exclusieve aanbiedingen."
    >
      <Link href="/" className="btn-primary">Begin met shoppen</Link>
    </BrandedState>
  );
}
