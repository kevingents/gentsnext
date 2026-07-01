import { mollieConfigured } from "@/lib/mollie";
import { worldlineConfigured } from "@/lib/worldline";
import { getSettings } from "@/lib/settings";

/**
 * Betaalprovider-schakelaar. Worldline OF Mollie als online betaalmethode, zonder
 * een big-bang: de actieve provider komt uit de env-var PAYMENT_PROVIDER (harde
 * override in Vercel) of anders uit de instelbare settings-store
 * (settings.paymentProvider, in de backend te wijzigen). Default = 'mollie' zodat
 * er niets verandert tot Worldline bewezen live werkt.
 */
export type PaymentProvider = "mollie" | "worldline";

export async function activePaymentProvider(): Promise<PaymentProvider> {
  const fromEnv = String(process.env.PAYMENT_PROVIDER || "").toLowerCase();
  if (fromEnv === "worldline") return "worldline";
  if (fromEnv === "mollie") return "mollie";
  try {
    const s = (await getSettings()) as unknown as { paymentProvider?: string };
    if (String(s?.paymentProvider || "").toLowerCase() === "worldline") return "worldline";
  } catch {
    /* val terug op default */
  }
  return "mollie";
}

/** Is de (actieve of opgegeven) provider geconfigureerd? Zo niet → checkout toont "binnenkort live". */
export async function paymentConfigured(provider?: PaymentProvider): Promise<boolean> {
  const p = provider || (await activePaymentProvider());
  return p === "worldline" ? worldlineConfigured() : mollieConfigured();
}
