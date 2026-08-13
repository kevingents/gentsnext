import { googleWalletConfigured } from "@/lib/google-wallet-config";

/**
 * Google Wallet-kaart bijwerken voor één klant, met dezelfde vorm als
 * pushPassUpdate(customerId) bij Apple — zodat elk schrijfpad dat de Apple-pas
 * bijwerkt er met één regel de Android-kant naast kan zetten.
 *
 * De saldo's worden hier opgehaald via een DYNAMISCHE import: lib/loyalty-claim
 * roept deze functie aan, dus een gewone import zou een kringetje maken. Zelfde
 * truc als lib/vouchers gebruikt voor de APNs-push.
 *
 * Werpt nooit en wacht nooit lang: een saldomutatie mag hier niet op stuklopen.
 */
export async function pushGoogleWalletForCustomer(customerId: string): Promise<boolean> {
  const id = String(customerId || "").trim();
  if (!id || !googleWalletConfigured()) return false;
  try {
    const [{ redeemableBalance, pendingBalance }, { activeVouchersForCustomer }, { pushGoogleWalletUpdate }] =
      await Promise.all([
        import("@/lib/loyalty-claim"),
        import("@/lib/vouchers"),
        import("@/lib/google-wallet"),
      ]);
    const [points, pending, tegoeden] = await Promise.all([
      redeemableBalance(id).then((p) => Math.max(0, p)),
      pendingBalance(id).then((p) => Math.max(0, p)),
      activeVouchersForCustomer({ customerId: id }),
    ]);
    return await pushGoogleWalletUpdate({
      customerId: id,
      // De naam staat al op de kaart en verandert hier niet; Google laat 'm staan
      // als we 'm niet meesturen, dus we patchen alleen wat écht wijzigt.
      name: "",
      email: "",
      points,
      pending,
      vouchers: tegoeden.map((v) => ({ code: v.code, label: v.label, valueCents: v.valueCents })),
    });
  } catch (e) {
    console.warn("[google-wallet] bijwerken voor klant faalde:", (e as Error).message);
    return false;
  }
}
