import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionCustomer, getProfileData } from "@/lib/account";
import { getNewArrivalsInSize, getRecommendedFromHistory } from "@/lib/catalog";
import { walletConfigured } from "@/lib/apple-wallet";
import { ProfileClient } from "@/components/account/profile-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mijn GENTS",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");

  const [data, newInSize, recommended] = await Promise.all([
    getProfileData(customer.id, customer.email),
    getNewArrivalsInSize(customer.sizeProfile, 4),
    getRecommendedFromHistory(customer.id, customer.sizeProfile, 4),
  ]);

  // Serialiseer naar plain JSON (datums → ISO) voor de client component.
  const safe = JSON.parse(JSON.stringify({ ...data, newInSize, recommended }));
  const safeCustomer = {
    id: customer.id,
    email: customer.email,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
    loyaltyPoints: data.pointsBalance,
    sizeProfile: (customer.sizeProfile ?? {}) as Record<string, string>,
    marketingOptIn: customer.marketingOptIn,
    // Het beheer zit in de portal; hier hangt er nog één ingang naartoe. Welke
    // pagina's iemand daar mag zien bepaalt de portal zelf, dus we hoeven hier
    // niet meer te weten dan of dit een medewerker is.
    isStaff: Boolean(customer.isAdmin),
  };

  return <ProfileClient customer={safeCustomer} data={safe} walletEnabled={walletConfigured()} />;
}
