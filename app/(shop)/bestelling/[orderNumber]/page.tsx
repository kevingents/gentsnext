import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderForViewer } from "@/lib/orders";
import { getSessionCustomer } from "@/lib/account";
import { formatEuro } from "@/lib/pricing";
import { ClearCart } from "@/components/cart/clear-cart";
import { TrackPurchase } from "@/components/analytics/track-purchase";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Bestelling", robots: { index: false } };

type Props = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ t?: string }>;
};

export default async function OrderPage({ params, searchParams }: Props) {
  const { orderNumber } = await params;
  const { t } = await searchParams;
  // IDOR-bescherming: alleen tonen met geldig access-token (gast) of als eigenaar.
  const customer = await getSessionCustomer();
  const data = await getOrderForViewer(orderNumber, { token: t, customerId: customer?.id });
  if (!data) notFound();
  const { order, lines } = data;

  const paid = order.status === "paid";
  const pending = order.status === "open";
  const failed = ["failed", "expired", "canceled"].includes(order.status);

  return (
    <div className="mx-auto max-w-2xl px-gutter py-16">
      {paid ? <ClearCart /> : null}
      {paid ? <TrackPurchase orderNumber={order.orderNumber} totalCents={order.totalCents} /> : null}

      {paid ? (
        <>
          <p className="label-brand">Bedankt, {order.firstName || "voor je bestelling"}</p>
          <h1 className="mt-2 text-display-md">Je bestelling is bevestigd</h1>
          <p className="mt-3 font-sans text-ink-soft">
            We hebben je betaling ontvangen. Een bevestiging is onderweg naar {order.email}.
          </p>
        </>
      ) : pending ? (
        <>
          <p className="label-brand">Even geduld</p>
          <h1 className="mt-2 text-display-md">We bevestigen je betaling</h1>
          <p className="mt-3 font-sans text-ink-soft">
            Je betaling wordt verwerkt. Ververs deze pagina over een moment; je
            ontvangt ook een bevestiging per e-mail.
          </p>
        </>
      ) : failed ? (
        <>
          <p className="label-brand">Betaling niet afgerond</p>
          <h1 className="mt-2 text-display-md">Er is niet betaald</h1>
          <p className="mt-3 font-sans text-ink-soft">
            Je betaling is geannuleerd of verlopen. Je kunt het opnieuw proberen —
            er is niets afgeschreven.
          </p>
          <Link href="/afrekenen" className="btn-primary mt-6">
            Opnieuw afrekenen
          </Link>
        </>
      ) : null}

      <div className="mt-8 border-y border-line py-5">
        <p className="font-sans text-sm text-muted">Bestelnummer</p>
        <p className="font-display text-lg">{order.orderNumber}</p>
      </div>

      <ul className="divide-y divide-line">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 py-3 font-sans text-sm">
            <span className="min-w-0">
              {l.roleLabel ? <span className="text-muted">{l.roleLabel}: </span> : null}
              {l.title}
              <span className="text-muted">
                {" "}
                {[l.color, l.size && `maat ${l.size}`, `${l.quantity}×`].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span>{formatEuro(l.unitPriceCents * l.quantity)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-4 space-y-1.5 font-sans text-sm">
        <div className="flex justify-between"><dt className="text-muted">Subtotaal</dt><dd>{formatEuro(order.subtotalCents)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Verzending</dt><dd>{order.shippingCents === 0 ? "Gratis" : formatEuro(order.shippingCents)}</dd></div>
        <div className="flex justify-between border-t border-line pt-2 font-medium"><dt>Totaal</dt><dd className="font-display text-lg">{formatEuro(order.totalCents)}</dd></div>
      </dl>

      <Link href="/" className="btn-ghost mt-8">
        Verder winkelen
      </Link>
    </div>
  );
}
