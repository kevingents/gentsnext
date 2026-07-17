import type { Metadata } from "next";
import Link from "next/link";
import { fetchTicketForFollow } from "@/lib/helpdesk";
import { verifyFollowToken } from "@/lib/ticket-follow";
import { VraagVolgen } from "@/components/support/vraag-volgen";

export const dynamic = "force-dynamic";

// Volg-pagina's nooit indexeren (bevatten een ticket-token).
export const metadata: Metadata = { title: "Je vraag volgen", robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ t?: string }>;
};

/** Uniforme, neutrale foutpagina — identiek voor ontbrekende/ongeldige token én
 *  onbekende ref, zodat er niets te enumereren valt. */
function OngeldigeLink() {
  return (
    <div className="mx-auto max-w-lg px-gutter py-24 text-center">
      <p className="label-brand">Vraag volgen</p>
      <h1 className="mt-2 text-display-md">Deze link is niet (meer) geldig</h1>
      <p className="mx-auto mt-3 max-w-md font-sans text-sm text-ink-soft">
        De link om je vraag te volgen klopt niet of is verlopen. Open de meest recente e-mail van GENTS
        Klantenservice, of neem contact op via{" "}
        <a href="mailto:klantenservice@gents.nl" className="text-ink underline underline-offset-4">
          klantenservice@gents.nl
        </a>
        .
      </p>
      <Link href="/" className="btn-ghost mt-8 inline-block">
        Terug naar de winkel
      </Link>
    </div>
  );
}

export default async function VraagPage({ params, searchParams }: Props) {
  const { ref } = await params;
  const { t: token } = await searchParams;

  // Zonder token geen lookup: dat voorkomt een ref→bestaat-oracle.
  const found = token ? await fetchTicketForFollow(ref) : null;
  // Token verifiëren tegen het (server-side opgehaalde) requester-e-mail. De
  // e-mail komt nooit in de browser; alleen de geredigeerde ticket-weergave wel.
  const valid = !!found && !!token && verifyFollowToken(ref, found.email, token);

  if (!valid || !found) return <OngeldigeLink />;

  return <VraagVolgen ticket={found.ticket} refId={ref} token={token as string} />;
}
