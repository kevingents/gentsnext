import { NextResponse } from "next/server";
import {
  createOrder,
  attachMolliePayment,
  finalizeGiftcardCoveredOrder,
  voidUnpaidOrder,
  OutOfStockError,
  CheckoutError,
  type CheckoutItem,
  type DeliveryMethod,
} from "@/lib/orders";
import { createMolliePayment, isKnownMethod } from "@/lib/mollie";
import { createWorldlineCheckout } from "@/lib/worldline";
import { activePaymentProvider, paymentConfigured } from "@/lib/payments";
import { getSiteUrl } from "@/lib/site-url";
import { getSessionCustomer } from "@/lib/account";
import { getStores } from "@/lib/stores";
import { availableInStore } from "@/lib/store-core";
import { getLocale } from "@/lib/locale-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function bad(msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status: 400 });
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Ongeldige aanvraag.");
  }

  const c = body?.contact ?? {};
  const items: CheckoutItem[] = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) return bad("Je winkelwagen is leeg.");
  if (!c.email || !/.+@.+\..+/.test(c.email)) return bad("Vul een geldig e-mailadres in.");
  for (const f of ["firstName", "lastName"]) {
    if (!String(c[f] || "").trim()) return bad("Vul je naam in.");
  }

  const deliveryMethod: DeliveryMethod =
    body?.deliveryMethod === "express" ? "express" : body?.deliveryMethod === "pickup" ? "pickup" : "standard";
  // Wordt bij afhalen vervangen door de canonieke winkelnaam (server-casing),
  // zodat downstream (pick-opdrachten, mails, portal-filters) altijd matcht.
  let pickupStore = String(body?.pickupStore || "").trim();
  // Adres alleen vereist bij bezorgen; bij afhalen in winkel is een winkelkeuze nodig.
  if (deliveryMethod === "pickup") {
    if (!pickupStore) return bad("Kies een winkel om af te halen.");
    // Server-waarheid: de gekozen winkel moet bestaan én de HELE bestelling op
    // voorraad hebben — de checkout filtert al, maar voorraad kan wijzigen
    // tussen kiezen en afrekenen (en de client is niet te vertrouwen).
    const store = getStores().find((s) => s.title.toLowerCase() === pickupStore.toLowerCase());
    if (!store) return bad("Kies een winkel om af te halen.");
    pickupStore = store.title;
    const need = new Map<string, number>();
    for (const it of items) {
      const sku = String(it.sku || "").trim();
      if (sku) need.set(sku, (need.get(sku) || 0) + Math.max(1, Number(it.qty) || 1));
    }
    try {
      const avail = await availableInStore(store.title, [...need.keys()]);
      const lc = new Map<string, number>();
      for (const [k, v] of avail) lc.set(k.toLowerCase(), v);
      const missing = [...need].filter(([sku, qty]) => (lc.get(sku.toLowerCase()) ?? 0) < qty).map(([sku]) => sku);
      if (missing.length) {
        return NextResponse.json(
          {
            ok: false,
            error: `${store.title} heeft niet meer alles op voorraad. Kies een andere winkel of laat je bestelling bezorgen.`,
            pickupUnavailable: true,
            unavailableSkus: missing,
          },
          { status: 409 },
        );
      }
    } catch {
      // Fail-closed: zonder bevestigde winkelvoorraad geen afhaal-order.
      return bad("De winkelvoorraad kon niet worden gecontroleerd. Probeer het opnieuw of kies bezorgen.");
    }
  } else {
    for (const f of ["street", "houseNumber", "postalCode", "city"]) {
      if (!String(c[f] || "").trim()) return bad("Vul alle adresvelden in.");
    }
  }
  // Vooraf gekozen betaalmethode (gevalideerd) → Mollie slaat z'n keuzescherm over.
  const payMethod = isKnownMethod(body?.method) ? String(body.method) : undefined;
  const voucherCode = String(body?.voucherCode || "").trim();
  const giftcardCode = String(body?.giftcardCode || "").trim();
  // Ingelogde klant → order meteen aan het account koppelen (punten, zichtbaar in
  // "mijn bestellingen", juiste bedankt-CTA). Gast blijft mogelijk (customerId null).
  const sessionCustomer = await getSessionCustomer();
  // Taal van de klant vastleggen op de order: de bevestigingsmail vertrekt pas
  // vanuit de betaal-webhook en de statusmails uit het back-office — daar is de
  // sessie weg. De middleware slaat /api over, dus getLocale() leest hier de
  // locale-cookie die diezelfde middleware op elke /en-, /de-… pagina zet.
  const locale = await getLocale();
  let order;
  try {
    order = await createOrder(c, items, deliveryMethod, voucherCode, giftcardCode, pickupStore, "", sessionCustomer?.id ?? null, locale);
  } catch (e) {
    // Voorraad-gate weigert → geef de niet-leverbare SKU's terug zodat de checkout
    // ze kan markeren en de klant ze in één klik kan verwijderen.
    if (e instanceof OutOfStockError) {
      return NextResponse.json({ ok: false, error: e.message, unavailableSkus: e.skus }, { status: 409 });
    }
    // Alleen een bewust voor de klant geschreven melding (CheckoutError) mag door.
    // Al het andere is techniek: een rauwe `e.message` zette hier tot nu toe een
    // Postgres-fout mét kolomnamen in de foutbalk van de afrekenpagina — dat helpt
    // de klant niet en geeft onnodig prijs hoe de database eruitziet. Het échte
    // probleem hoort in het serverlog (Vercel runtime errors).
    if (e instanceof CheckoutError) return bad(e.message);
    console.error("[checkout] order aanmaken faalde:", e);
    return bad("Er ging iets mis bij het aanmaken van je bestelling. Probeer het opnieuw of neem contact met ons op.");
  }
  // Prijs-guard: de betaalknop toonde het client-totaal (localStorage-prijzen);
  // de server herprijst uit de DB. Wijkt dat af (sale gestart/afgelopen sinds
  // toevoegen) → order annuleren en de klant het nieuwe bedrag laten zien,
  // nooit stil een ander bedrag naar Mollie sturen dan de knop beloofde.
  const expectedTotalCents = Number(body?.expectedTotalCents);
  if (Number.isFinite(expectedTotalCents) && expectedTotalCents >= 0 && order.totalCents !== expectedTotalCents) {
    await voidUnpaidOrder(order.id).catch(() => {});
    return NextResponse.json(
      {
        ok: false,
        priceChanged: true,
        serverTotalCents: order.totalCents,
        error: "De prijzen zijn bijgewerkt sinds je de artikelen toevoegde. Controleer je winkelwagen — het actuele totaal is " +
          `€ ${(order.totalCents / 100).toFixed(2).replace(".", ",")}.`,
      },
      { status: 409 },
    );
  }

  // Vaste, server-bepaalde site-URL (nooit de client-Host) voor betaal-callbacks/
  // redirects — host-header-injectie mag een webhook/return niet kunnen wegkapen.
  const origin = getSiteUrl();

  // Volledig met cadeaubon (of 100%-voucher) betaald → geen Mollie nodig.
  if (order.totalCents === 0) {
    // Afronden (markeer betaald + mail + plan) is best-effort: faalt een stap, dan
    // krijgt de klant tóch de bevestigingspagina (order bestaat + cadeaubon is al
    // verzilverd); een retry/cron kan plannen/mailen alsnog afmaken.
    try {
      await finalizeGiftcardCoveredOrder(order.id);
    } catch (e) {
      console.error("[checkout] afronden cadeaubon-order faalde:", e);
    }
    return NextResponse.json({
      ok: true,
      configured: true,
      checkoutUrl: `${origin}/bestelling/${order.orderNumber}?t=${order.accessToken}`,
    });
  }

  // Provider-schakelaar: Worldline of Mollie. Niet geconfigureerd → order bewaard, betalen kan nog niet.
  const provider = await activePaymentProvider();
  if (!(await paymentConfigured(provider))) {
    return NextResponse.json({
      ok: true,
      configured: false,
      orderNumber: order.orderNumber,
      accessToken: order.accessToken,
      message: "Online afrekenen gaat binnenkort live. Je bestelling is nog niet verwerkt.",
    });
  }

  try {
    let checkoutUrl = "";
    let paymentRef = "";
    if (provider === "worldline") {
      const co = await createWorldlineCheckout({
        amountCents: order.totalCents,
        merchantReference: order.orderNumber,
        // De klant komt terug op onze return-route (past de status meteen toe) → bevestigingspagina.
        // De webhook is de onafhankelijke backup.
        returnUrl: `${origin}/api/payments/worldline/return?on=${encodeURIComponent(order.orderNumber)}&t=${encodeURIComponent(order.accessToken)}`,
      });
      checkoutUrl = co.redirectUrl;
      paymentRef = co.hostedCheckoutId;
    } else {
      const payment = await createMolliePayment({
        amountCents: order.totalCents,
        description: `GENTS bestelling ${order.orderNumber}`,
        redirectUrl: `${origin}/bestelling/${order.orderNumber}?t=${order.accessToken}`,
        cancelUrl: `${origin}/afrekenen?geannuleerd=1`,
        webhookUrl: `${origin}/api/webhooks/mollie`,
        metadata: { orderNumber: order.orderNumber },
        idempotencyKey: `order-${order.id}`,
        method: payMethod,
      });
      checkoutUrl = payment.checkoutUrl || "";
      paymentRef = payment.id;
    }
    // Betaalref opslaan in orders.molliePaymentId (generiek: Mollie-id óf Worldline-hostedCheckoutId)
    // + de voorraad-hold verlengen naar 24u.
    await attachMolliePayment(order.id, paymentRef);
    if (!checkoutUrl) {
      // Geen betaal-URL → de klant kán niet betalen; draai de order terug zodat de
      // voucher/cadeaubon/voorraad niet verbrand achterblijven (B2).
      await voidUnpaidOrder(order.id).catch((err) => console.error("[checkout] void na lege checkout-URL:", err));
      return bad("Betaling kon niet worden gestart.");
    }
    return NextResponse.json({ ok: true, configured: true, checkoutUrl });
  } catch (e) {
    // Betaalprovider gooide (API-fout/timeout) → geen bruikbare betaling; order terugdraaien
    // zodat verbruikte voucher/cadeaubon + voorraad-holds direct vrijkomen.
    await voidUnpaidOrder(order.id).catch((err) => console.error("[checkout] void na provider-fout:", err));
    // Zelfde regel als hierboven: de rauwe provider-melding (API-veldnamen, HTTP-body
    // van Mollie/Worldline) is niets voor de klant. Log 'm, toon een bruikbare zin.
    console.error("[checkout] betaling starten faalde bij provider:", e);
    return NextResponse.json(
      { ok: false, error: "Het betaalscherm kon niet worden geopend. Probeer het zo nog eens — je bestelling is niet verwerkt." },
      { status: 502 }
    );
  }
}
