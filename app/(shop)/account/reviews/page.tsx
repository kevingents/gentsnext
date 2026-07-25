import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { can } from "@/lib/permissions";
import { GeenToegang } from "@/components/account/geen-toegang";
import { listReviewsForModeration } from "@/lib/reviews-db";
import { ReviewsModeration } from "@/components/account/reviews-moderation";
import { BackofficeShell } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reviews", robots: { index: false, follow: false } };

export default async function ReviewsAdminPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");
  if (!can(customer, "presentatie")) {
    return <GeenToegang permission="presentatie" />;
  }

  const pending = await listReviewsForModeration("pending", 200);
  const items = pending.map((r) => ({
    id: r.id,
    productHandle: r.productHandle,
    authorName: r.authorName || "GENTS-klant",
    rating: r.rating,
    title: r.title,
    body: r.body,
    fit: r.fit,
    // Modereren kan zonder het adres van de schrijver; dat is een klantgegeven.
    // Wie ook het recht "klanten" heeft ziet het wél — handig om een review aan
    // een bestelling te koppelen. De rest krijgt het niet eens mee naar de browser.
    email: can(customer, "klanten") ? r.email : "",
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <BackofficeShell active="/account/reviews" title="Reviews">
      <p className="font-sans text-sm text-pslate">
        {items.length} review(s) wachten op moderatie. Geverifieerde kopers worden automatisch geplaatst.
      </p>
      <ReviewsModeration initial={items} />
    </BackofficeShell>
  );
}
