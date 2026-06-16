import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { GiftcardRedeem } from "@/components/account/giftcard-redeem";
import { BackofficeShell } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cadeaubonnen", robots: { index: false, follow: false } };

export default async function GiftcardsAdminPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");
  if (!customer.isAdmin) {
    return (
      <div className="mx-auto max-w-page px-gutter py-16">
        <h1 className="text-display-md">Geen toegang</h1>
        <Link href="/account" className="mt-6 inline-block font-sans text-sm text-ink underline">← Terug</Link>
      </div>
    );
  }

  return (
    <BackofficeShell active="/account/cadeaubonnen" title="Cadeaubonnen — verzilveren">
      <GiftcardRedeem />
    </BackofficeShell>
  );
}
