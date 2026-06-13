import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionCustomer, getProfileData } from "@/lib/account";
import { ProfileClient } from "@/components/account/profile-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mijn GENTS",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");

  const data = await getProfileData(customer.id);

  // Serialiseer naar plain JSON (datums → ISO) voor de client component.
  const safe = JSON.parse(JSON.stringify(data));
  const safeCustomer = {
    id: customer.id,
    email: customer.email,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
    loyaltyPoints: data.pointsBalance,
    sizeProfile: (customer.sizeProfile ?? {}) as Record<string, string>,
    marketingOptIn: customer.marketingOptIn,
    isAdmin: customer.isAdmin,
  };

  return <ProfileClient customer={safeCustomer} data={safe} />;
}
