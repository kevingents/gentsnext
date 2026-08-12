import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PKPass } from "passkit-generator";
import { b64Pem, walletConfigured, walletWebServiceUrl, passAuthToken } from "@/lib/apple-wallet-config";

// Her-export zodat bestaande imports `from "@/lib/apple-wallet"` blijven werken.
export { walletConfigured, walletWebServiceUrl, passAuthToken, verifyPassAuth } from "@/lib/apple-wallet-config";

/**
 * Apple Wallet — GENTS spaarpas (.pkpass, storeCard).
 *
 * Een geldige pas moet ondertekend worden met een Apple **Pass Type ID-certificaat**
 * uit het GENTS Apple Developer-account. Die secrets staan in Vercel-env (base64),
 * NIET in de code. Zonder certificaat is `walletConfigured()` false en biedt de site
 * de wallet-knop niet aan — de feature schakelt vanzelf aan zodra de env gezet is.
 *
 * Benodigde env-vars (base64-PEM tenzij anders vermeld):
 *   APPLE_PASS_TYPE_ID              bv. pass.nl.gents.loyalty
 *   APPLE_TEAM_ID                   je Apple Team ID (10 tekens)
 *   APPLE_WALLET_SIGNER_CERT        base64 van de pass-cert (PEM)
 *   APPLE_WALLET_SIGNER_KEY         base64 van de private key (PEM)
 *   APPLE_WALLET_SIGNER_KEY_PASSPHRASE   (optioneel) wachtwoord van de key
 *   APPLE_WALLET_WWDR              base64 van het Apple WWDR-tussencertificaat (PEM)
 */

// Merk-afbeeldingen (uit public/brand) worden bij de route meegebundeld via
// next.config `outputFileTracingIncludes`. Eén keer inlezen + cachen.
let imgCache: { icon: Buffer; logo: Buffer } | null = null;
function passImages() {
  if (imgCache) return imgCache;
  const root = process.cwd();
  imgCache = {
    // Zwarte pas → WITTE merk-assets (Kevin, 21 juli: "zoals onze zwarte pas,
    // wit logo"). Wit vierkant icoon (notificaties/lockscreen) + witte wordmark.
    icon: readFileSync(join(root, "public/brand/wallet-icon-wit.png")),
    logo: readFileSync(join(root, "public/brand/brand-logo-wit.png")),
  };
  return imgCache;
}

export type LoyaltyPassInput = {
  customerId: string;
  name: string;
  email: string;
  points: number;
  /** Nog niet besteedbaar (recente aankoop). 0/undefined = niets in behandeling. */
  pending?: number;
  /** Wanneer die punten besteedbaar worden. */
  pendingVestsAt?: Date | string | null;
  memberSince?: Date | string | null;
  /**
   * Openstaande tegoedbonnen. Staan op de pas zodat de klant in de winkel niets
   * hoeft op te zoeken: de kassier scant de QR (= het klant-id) en haalt via
   * /api/core/voucher op wat er openstaat. De codes staan er ook letterlijk bij,
   * zodat het ook werkt aan een kassa die alleen een code-invoerveld heeft.
   */
  vouchers?: { code: string; label: string; valueCents?: number; verlooptOp?: Date | string | null }[];
};

/**
 * Bouwt een ondertekende GENTS-spaarpas (.pkpass) voor één klant. Premium look:
 * zwarte pas met wit logo, QR met de klant-referentie (scanbaar aan de kassa om
 * te sparen/inwisselen). serialNumber = customerId → opnieuw downloaden werkt de
 * bestaande pas bij i.p.v. een tweede pas te maken.
 */
/** Bedrag voor op de pas — kort, want een pas-veld is smal. */
function euroKort(cents: number): string {
  return (cents / 100).toLocaleString("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function buildLoyaltyPass(input: LoyaltyPassInput): Buffer {
  if (!walletConfigured()) throw new Error("Apple Wallet is niet geconfigureerd.");
  const { icon, logo } = passImages();
  const points = Math.max(0, Math.round(Number(input.points) || 0));
  const pending = Math.max(0, Math.round(Number(input.pending) || 0));
  const vestDatum = input.pendingVestsAt ? new Date(input.pendingVestsAt) : null;
  // Datum in de NL-tijdzone, niet die van de server (die staat op UTC).
  const vestLabel = vestDatum && !isNaN(vestDatum.getTime())
    ? vestDatum.toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" })
    : null;
  const memberCode = "GENTS " + input.customerId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const sinceYear = input.memberSince ? new Date(input.memberSince).getFullYear() : null;

  const pass = new PKPass(
    {
      "icon.png": icon,
      "icon@2x.png": icon,
      "icon@3x.png": icon,
      "logo.png": logo,
      "logo@2x.png": logo,
    },
    {
      wwdr: b64Pem("APPLE_WALLET_WWDR"),
      signerCert: b64Pem("APPLE_WALLET_SIGNER_CERT"),
      signerKey: b64Pem("APPLE_WALLET_SIGNER_KEY"),
      signerKeyPassphrase: process.env.APPLE_WALLET_SIGNER_KEY_PASSPHRASE || undefined,
    },
    {
      passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
      teamIdentifier: process.env.APPLE_TEAM_ID!,
      serialNumber: input.customerId,
      organizationName: "GENTS",
      description: "GENTS Spaarpas",
      backgroundColor: "rgb(17, 17, 17)",
      foregroundColor: "rgb(255, 255, 255)",
      labelColor: "rgb(178, 174, 168)",
      // Web-service: hiermee kan iOS de pas zelf verversen (pull + APNs-push
      // bij een saldowijziging). Beide velden zijn verplicht om 'm te activeren.
      webServiceURL: walletWebServiceUrl(),
      authenticationToken: passAuthToken(input.customerId),
    },
  );

  const tegoeden = (input.vouchers ?? []).filter((v) => v.code);
  const tegoedCents = tegoeden.reduce((s, v) => s + (Number(v.valueCents) || 0), 0);

  pass.type = "storeCard";
  pass.primaryFields.push({
    key: "balance",
    label: "Spaarpunten",
    value: String(points),
    // iOS toont dit als melding zodra het saldo op de pas verandert.
    changeMessage: "Je hebt nu %@ spaarpunten",
  });
  pass.secondaryFields.push({ key: "member", label: "Lid", value: input.name });
  /* Volgorde op waarde: tegoed (uitgeefbaar) → punten in behandeling (verklaart
     waarom het saldo nog laag is) → lid sinds (decoratief). Er is maar plek voor
     een handvol velden, dus "lid sinds" valt als eerste af. */
  if (tegoeden.length) {
    pass.auxiliaryFields.push({
      key: "credit",
      label: tegoeden.length === 1 ? "Tegoed" : `Tegoed (${tegoeden.length})`,
      value: tegoedCents > 0 ? euroKort(tegoedCents) : tegoeden[0].label,
    });
  }
  /* Zonder dit veld leest de pas als "0 punten" terwijl de klant net gekocht
     heeft: punten vesten pas na de retourtermijn (21 dagen). */
  if (pending > 0) {
    pass.auxiliaryFields.push({
      key: "pending",
      label: "In behandeling",
      value: String(pending),
      changeMessage: "Er staan %@ punten in behandeling",
    });
  }
  if (!tegoeden.length && pending <= 0 && sinceYear) {
    pass.auxiliaryFields.push({ key: "since", label: "Lid sinds", value: String(sinceYear) });
  }
  pass.backFields.push(
    {
      key: "how",
      label: "Zo werkt het",
      value:
        "Je spaart 1 punt per bestede euro — online én in de winkel. Laat deze pas scannen bij de kassa om te sparen en punten in te wisselen. Punten van een nieuwe aankoop worden besteedbaar na de retourtermijn.",
    },
    {
      key: "value",
      label: "Je saldo",
      value:
        pending > 0
          ? `${points} punten besteedbaar. ${pending} punten zijn nog in behandeling${vestLabel ? ` — besteedbaar vanaf ${vestLabel}` : ""}.`
          : `${points} punten besteedbaar.`,
    },
  );
  if (tegoeden.length) {
    pass.backFields.push({
      key: "credit-detail",
      label: tegoeden.length === 1 ? "Je tegoedbon" : "Je tegoedbonnen",
      // Code voluit: werkt ook aan een kassa die alleen een code-invoerveld heeft.
      value: tegoeden
        .map((v) => `${v.code} — ${v.label}${v.verlooptOp ? ` (geldig t/m ${new Date(v.verlooptOp).toLocaleDateString("nl-NL")})` : ""}`)
        .join("\n"),
    });
  }
  pass.backFields.push(
    { key: "account", label: "Account", value: "Bekijk en verzilver je punten op gents.nl/account." },
    {
      key: "terms",
      label: "Voorwaarden",
      value: "Punten zijn persoonlijk en niet inwisselbaar voor contant geld. Zie gents.nl voor de actievoorwaarden.",
    },
  );
  pass.setBarcodes({
    format: "PKBarcodeFormatQR",
    message: input.customerId,
    messageEncoding: "iso-8859-1",
    altText: memberCode,
  });

  return pass.getAsBuffer();
}
