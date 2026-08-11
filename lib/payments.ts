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

/** Waar de actieve keuze vandaan komt. "env" overrulet de knop in Instellingen. */
export type ProviderBron = "env" | "instelling" | "standaard";

export type ProviderStatus = {
  actief: PaymentProvider;
  bron: ProviderBron;
  /** De ruwe env-waarde, leeg als PAYMENT_PROVIDER niet gezet is. */
  envWaarde: string;
  /** Staat de instelling in de database (los van of de env hem overrulet)? */
  ingesteld: PaymentProvider;
  mollieKlaar: boolean;
  worldlineKlaar: boolean;
};

function leesEnv(): PaymentProvider | null {
  const v = String(process.env.PAYMENT_PROVIDER || "").toLowerCase();
  return v === "worldline" || v === "mollie" ? v : null;
}

/**
 * Volledige stand van zaken, voor het Instellingen-scherm. Los van
 * activePaymentProvider() omdat het scherm móét kunnen laten zien dát de
 * env-var de knop overruleert — anders klikt iemand en gebeurt er niets.
 */
export async function paymentProviderStatus(): Promise<ProviderStatus> {
  const env = leesEnv();
  let ingesteld: PaymentProvider = "mollie";
  let uitDb = false;
  try {
    const s = (await getSettings()) as unknown as { paymentProvider?: string };
    const v = String(s?.paymentProvider || "").toLowerCase();
    if (v === "worldline" || v === "mollie") {
      ingesteld = v;
      uitDb = true;
    }
  } catch {
    /* val terug op de standaard */
  }
  return {
    actief: env ?? ingesteld,
    bron: env ? "env" : uitDb ? "instelling" : "standaard",
    envWaarde: String(process.env.PAYMENT_PROVIDER || ""),
    ingesteld,
    mollieKlaar: mollieConfigured(),
    worldlineKlaar: worldlineConfigured(),
  };
}

export async function activePaymentProvider(): Promise<PaymentProvider> {
  const env = leesEnv();
  if (env) return env;
  try {
    const s = (await getSettings()) as unknown as { paymentProvider?: string };
    const v = String(s?.paymentProvider || "").toLowerCase();
    if (v === "worldline") return "worldline";
    if (v === "mollie") return "mollie";
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
