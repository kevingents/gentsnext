import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { can } from "@/lib/permissions";
import { GeenToegang } from "@/components/account/geen-toegang";
import { GiftcardRedeem } from "@/components/account/giftcard-redeem";
import { BackofficeShell } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cadeaubonnen", robots: { index: false, follow: false } };

export default async function GiftcardsAdminPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");
  if (!can(customer, "operatie")) {
    return <GeenToegang permission="operatie" />;
  }

  return (
    <BackofficeShell active="/account/cadeaubonnen" title="Cadeaubonnen — verzilveren">
      <GiftcardRedeem />
    </BackofficeShell>
  );
}
