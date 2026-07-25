import { unstable_cache } from "next/cache";
import { getMollieMethods, type MollieMethod } from "@/lib/mollie";
import { activePaymentProvider } from "@/lib/payments";

/**
 * Smalle betaalmethoden-strip onderaan de footer. Tekstueel, in huisstijl.
 *
 * Stond hier een handgeschreven lijstje (o.a. Apple Pay en PayPal) dat niets met
 * de checkout te maken had: methodes die bij het afrekenen niet worden
 * aangeboden, beloofden we in de footer wél. Daarom komt de lijst nu uit
 * dezelfde bron als de afrekenpagina — getMollieMethods(), precies wat
 * /api/payment-methods teruggeeft — inclusief dezelfde labels (m.description),
 * zodat footer en checkout niet meer uit elkaar kunnen lopen.
 */

/**
 * Terugval als de provider niet bereikbaar of niet geconfigureerd is (en voor
 * Worldline, dat geen methode-lijst-API heeft). Bewust minimaal: alleen wat de
 * site sowieso al belooft ("Veilig betalen met iDEAL") plus creditcard — nooit
 * Apple Pay, PayPal of Klarna gokken, want dát was juist de valse belofte.
 */
const FALLBACK = ["iDEAL", "Creditcard"];

/**
 * De footer staat op élke pagina; Mollie per weergave bevragen is zonde. De
 * lijst verandert alleen als er een methode aan/uit gaat, dus één keer per uur
 * ophalen volstaat. De race erbovenop is een harde bovengrens: een trage
 * provider mag nooit de paginaweergave gijzelen — dan liever de terugval.
 */
const cachedMethods = unstable_cache(
  async (): Promise<MollieMethod[]> =>
    Promise.race([
      getMollieMethods(),
      new Promise<MollieMethod[]>((resolve) => setTimeout(() => resolve([]), 2500)),
    ]),
  ["footer-payment-methods"],
  { revalidate: 3600 },
);

export async function FooterPayments() {
  const provider = await activePaymentProvider();
  const methods = provider === "mollie" ? await cachedMethods() : [];
  // Dedupe: Mollie kan varianten teruggeven (bv. twee Klarna-smaken) die dezelfde
  // omschrijving delen — anders dubbele chips én dubbele React-keys.
  const labels = methods.length ? Array.from(new Set(methods.map((m) => m.description))).slice(0, 8) : FALLBACK;

  return (
    <div className="mx-auto flex max-w-page flex-wrap items-center justify-center gap-x-4 gap-y-2 px-gutter py-3 text-canvas/60">
      {labels.map((m) => (
        <span key={m} className="border border-canvas/15 px-3 py-1 font-sans text-[0.7rem] uppercase tracking-wider">
          {m}
        </span>
      ))}
    </div>
  );
}
