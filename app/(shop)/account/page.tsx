import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { walletAppleRegistrations } from "@/db/schema";
import { getSessionCustomer, getProfileData } from "@/lib/account";
import { getNewArrivalsInSize, getRecommendedFromHistory } from "@/lib/catalog";
import { walletConfigured } from "@/lib/apple-wallet";
import { googleWalletConfigured } from "@/lib/google-wallet-config";
import { bonusTasks } from "@/lib/loyalty-bonus";
import type { ProfilePreferences } from "@/lib/profiel-voorkeuren";
import { getStores } from "@/lib/stores";
import { getSettings } from "@/lib/settings";
import { getNewsletterPrefs } from "@/lib/newsletter";
import { ProfileClient } from "@/components/account/profile-client";
// De QR van de memberspas wordt hier op de SERVER gebouwd: aan een kassa moet de
// code er al staan bij de eerste render, niet pas als de browser klaar is met
// JavaScript laden.
import { clubPassData } from "@/lib/club-pass";
import { pageMetadata } from "@/lib/page-meta-i18n";

/** Staat de memberspas op minstens één toestel? serialNumber = het klant-id. */
async function walletInstalled(customerId: string): Promise<boolean> {
  try {
    const rows = await getDb()
      .select({ d: walletAppleRegistrations.deviceLibraryIdentifier })
      .from(walletAppleRegistrations)
      .where(eq(walletAppleRegistrations.serialNumber, customerId))
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata("/account");
}

export default async function AccountPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");

  const [data, newInSize, recommended, walletOnDevice, newsletter] = await Promise.all([
    getProfileData(customer.id, customer.email),
    getNewArrivalsInSize(customer.sizeProfile, 4),
    getRecommendedFromHistory(customer.id, customer.sizeProfile, 4),
    walletInstalled(customer.id),
    // Server-side: anders staan de schakelaars eerst even op "uit" en ziet de
    // klant zichzelf uitgeschreven worden terwijl hij dat niet is.
    getNewsletterPrefs(customer.email, customer.phone).catch(() => null),
  ]);
  const bonussen = await bonusTasks(customer, walletOnDevice);

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
    preferences: (customer.preferences ?? {}) as ProfilePreferences,
    marketingOptIn: customer.marketingOptIn,
    // Het beheer zit in de portal; hier hangt er nog één ingang naartoe. Welke
    // pagina's iemand daar mag zien bepaalt de portal zelf, dus we hoeven hier
    // niet meer te weten dan of dit een medewerker is.
    isStaff: Boolean(customer.isAdmin),
  };

  /* De inwisselkoers staat in de tool, niet in de code: zonder deze prop
     rekende het scherm met een eigen 500/EUR 25 en liep het uit de pas zodra
     iemand de koers aanpaste. */
  const { loyaltyConfig } = await getSettings();

  return (
    <ProfileClient
      customer={safeCustomer}
      data={safe}
      pass={clubPassData(customer.id)}
      redeem={{
        minPoints: loyaltyConfig.redeemMinPoints,
        stepPoints: loyaltyConfig.redeemStepPoints || loyaltyConfig.redeemMinPoints,
        centsPerPoint: loyaltyConfig.redeemCentsPerPoint,
      }}
      walletEnabled={walletConfigured()}
      googleWalletEnabled={googleWalletConfigured()}
      bonuses={bonussen}
      stores={getStores().map((s) => ({ pageHandle: s.pageHandle, title: s.title, city: s.city }))}
      newsletter={newsletter ?? undefined}
    />
  );
}
