import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderForViewer, getPostPurchase } from "@/lib/orders";
import { getSessionCustomer } from "@/lib/account";
import { formatEuro } from "@/lib/pricing";
import { ClearCart } from "@/components/cart/clear-cart";
import { TrackPurchase } from "@/components/analytics/track-purchase";
import { CareBlock } from "@/components/pdp/care-material";
import { ProductCard } from "@/components/product-card";

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

  // Post-purchase: verzorgingstips + cross-sell (alleen bij een betaalde order).
  const extras = paid ? await getPostPurchase(lines.map((l) => l.productHandle)) : null;

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
        {order.companyName ? (
          <p className="mt-2 font-sans text-sm text-ink-soft">
            Zakelijke bestelling — <span className="text-ink">{order.companyName}</span>
            {order.vatNumber ? ` · BTW ${order.vatNumber}` : ""}
          </p>
        ) : null}
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

      {paid ? (
        <div className="mt-8 flex flex-col items-start gap-2 rounded-card bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-sans text-sm text-ink-soft">
            <span className="font-medium text-ink">Blij met je aankoop?</span> Help andere klanten met een korte review.
          </p>
          <Link href={`/review/${order.orderNumber}${t ? `?t=${t}` : ""}`} className="btn-ghost shrink-0">
            Schrijf een review
          </Link>
        </div>
      ) : null}

      {paid && extras?.careItems.length ? (
        <section className="mt-12 border-t border-line pt-8">
          <p className="label-brand">Zo geniet je er lang van</p>
          <h2 className="mt-2 font-display text-xl">Verzorgingstips voor je aankoop</h2>
          <div className="mt-4"><CareBlock items={extras.careItems} prose={[]} /></div>
        </section>
      ) : null}

      {paid && !order.customerId ? (
        <section className="mt-10 flex flex-col items-start gap-3 rounded-card bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-lg">Maak een account aan</p>
            <p className="mt-1 font-sans text-sm text-ink-soft">Volg je bestelling, bewaar je maten en bestel een volgende keer sneller.</p>
          </div>
          <Link href="/account/login" className="btn-primary shrink-0">Account aanmaken</Link>
        </section>
      ) : null}

      {paid && extras?.recommendations.length ? (
        <section className="mt-12">
          <p className="label-brand">Maak je outfit compleet</p>
          <h2 className="mt-2 font-display text-xl">Hier draag je het bij</h2>
          <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
            {extras.recommendations.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : null}

      <Link href="/" className="btn-ghost mt-12">
        Verder winkelen
      </Link>
    </div>
  );
}
