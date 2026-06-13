import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { SizeMediaForm } from "@/components/account/size-media-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Productmedia", robots: { index: false, follow: false } };

export default async function ProductMediaPage() {
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
    <div className="mx-auto max-w-2xl px-gutter py-10">
      <p className="label-brand">Beheer</p>
      <h1 className="mt-2 text-display-md">Modelfoto's</h1>
      <p className="mt-3 font-sans text-sm text-ink-soft">
        Stel per product een <strong>reguliere modelfoto</strong> in (die de galerij
        leidt — model eerst) en een <strong>grote-maat-foto</strong> die getoond
        wordt zodra de klant een grote maat kiest. AI-gegenereerd of echt — plak de
        afbeeldings-URL.
      </p>
      <SizeMediaForm />
    </div>
  );
}
