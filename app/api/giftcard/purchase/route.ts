import { NextResponse } from "next/server";
import { purchaseGiftcard, attachGiftcardPayment } from "@/lib/giftcards";
import { mollieConfigured, createMolliePayment } from "@/lib/mollie";
import { getSessionCustomer } from "@/lib/account";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Koopt een cadeaubon: maakt een 'pending' bon + start de Mollie-betaling. */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const customer = await getSessionCustomer();
  const result = await purchaseGiftcard({
    amountCents: Number(body?.amountCents),
    recipientName: String(body?.recipientName || ""),
    recipientEmail: String(body?.recipientEmail || ""),
    senderName: String(body?.senderName || ""),
    message: String(body?.message || ""),
    buyerEmail: String(body?.buyerEmail || customer?.email || ""),
    customerId: customer?.id ?? null,
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });

  if (!mollieConfigured()) {
    return NextResponse.json({
      ok: true,
      configured: false,
      message: "Online afrekenen gaat binnenkort live. Je cadeaubon is nog niet verwerkt.",
    });
  }

  const origin = getSiteUrl(); // canonieke site-URL, niet de client-Host (webhook-kaping)
  try {
    const payment = await createMolliePayment({
      amountCents: result.amountCents,
      description: `GENTS cadeaubon ${result.code}`,
      redirectUrl: `${origin}/cadeaubon/bedankt`,
      cancelUrl: `${origin}/cadeaubon?geannuleerd=1`,
      webhookUrl: `${origin}/api/webhooks/mollie`,
      metadata: { kind: "giftcard", giftcardId: result.id },
      idempotencyKey: `giftcard-${result.id}`,
    });
    await attachGiftcardPayment(result.id, payment.id);
    if (!payment.checkoutUrl) {
      return NextResponse.json({ ok: false, error: "Betaling kon niet worden gestart." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, configured: true, checkoutUrl: payment.checkoutUrl });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Betaling starten mislukte." },
      { status: 502 }
    );
  }
}
