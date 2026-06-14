import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { listReviewsForModeration } from "@/lib/reviews-db";
import { ReviewsModeration } from "@/components/account/reviews-moderation";
import { BackofficeShell } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reviews", robots: { index: false, follow: false } };

export default async function ReviewsAdminPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");
  if (!customer.isAdmin) {
    return (
      <div className="mx-auto max-w-page px-gutter py-16">
        <h1 className="text-display-md">Geen toegang</h1>
        <Link href="/account" className="mt-6 inline-block font-sans text-sm text-ink underline">
          ← Terug
        </Link>
      </div>
    );
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
    email: r.email,
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
