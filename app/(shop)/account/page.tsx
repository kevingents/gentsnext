import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionCustomer, getProfileData } from "@/lib/account";
import { isStaff, permissionsOf, firstAllowedRoute } from "@/lib/permissions";
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
    // Snelkoppelingen naar de studio: iedereen met minstens één recht ziet ze,
    // niet alleen beheerders. Welke links precies volgt uit de rechten — een
    // link naar iets waar je toch niet in mag is alleen maar verwarrend.
    isStaff: isStaff(customer),
    permissions: permissionsOf(customer),
    // Altijd één ingang naar de studio, ook voor iemand die geen van de vaste
    // snelkoppelingen mag zien (een redacteur bijvoorbeeld) — anders staat hij
    // met rechten en al voor een dichte deur.
    studioHref: firstAllowedRoute(customer),
  };

  return <ProfileClient customer={safeCustomer} data={safe} walletEnabled={walletConfigured()} />;
}
