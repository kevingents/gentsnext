import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { can } from "@/lib/permissions";
import { GeenToegang } from "@/components/account/geen-toegang";
import { getOccasions } from "@/lib/occasions-server";
import { BackofficeShell } from "@/components/account/report-ui";
import { OccasionsManager, type AdminOccasion } from "@/components/account/occasions-manager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Gelegenheden", robots: { index: false, follow: false } };

/**
 * Site-studio → Gelegenheden. De tegels op /gelegenheden (lib/occasions-server,
 * opgeslagen als content:occasions via lib/content-store). Zolang er niets is
 * opgeslagen toont de site de ingebouwde standaard; de eerste keer opslaan legt
 * die vast in de content-store.
 */
export default async function OccasionsAdminPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");

  if (!can(customer, "content")) {
    return <GeenToegang permission="content" />;
  }

  const items: AdminOccasion[] = (await getOccasions()).map((o) => ({
    slug: o.slug,
    title: o.title,
    eyebrow: o.eyebrow || "",
    intro: o.intro || "",
    image: o.image || "",
    ctaLabel: o.ctaLabel || "",
    ctaHref: o.ctaHref || "",
    links: (o.links || []).map((l) => ({ label: l.label, href: l.href })),
  }));

  return (
    <BackofficeShell active="/account/gelegenheden" title="Gelegenheden">
      <p className="font-sans text-sm text-pslate">
        De tegels op /gelegenheden — bruiloft, gala, zakelijk, uitvaart. Titel, tekst, beeld en de links eronder.
        Wijzigingen zijn direct zichtbaar op de site.
      </p>
      <OccasionsManager initial={items} />
    </BackofficeShell>
  );
}
