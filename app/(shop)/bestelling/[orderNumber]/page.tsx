import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderForViewer, getPostPurchase } from "@/lib/orders";
import { getSettings } from "@/lib/settings";
import { allocateOrder, type FulfillmentPlan } from "@/lib/fulfillment";
import { getSessionCustomer } from "@/lib/account";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";
import { formatEuro } from "@/lib/pricing";
import { ClearCart } from "@/components/cart/clear-cart";
import { TrackPurchase } from "@/components/analytics/track-purchase";
import { CareBlock } from "@/components/pdp/care-material";
import { ProductCard } from "@/components/product-card";
import { OrderStatusPoller } from "@/components/order/order-status-poller";
import { ReorderButton } from "@/components/order/reorder-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Bestelling", robots: { index: false } };

type Props = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ t?: string }>;
};

/** Vertaalfunctie zoals getT die teruggeeft (voor helpers buiten de component). */
type Tr = (key: string, params?: Record<string, string | number>) => string;

/** Telt werkdagen op bij een datum (weekend overslaan) — voor de bezorgschatting. */
function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < Math.max(0, days)) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}
function fmtDate(d: Date, locale: string): string {
  return d.toLocaleDateString(locale === "nl" ? "nl-NL" : locale, { weekday: "long", day: "numeric", month: "long" });
}

// Verzonnen picker-namen — deterministisch per filiaal, zodat dezelfde winkel
// altijd dezelfde "collega" toont (persoonlijke touch op de bevestiging).
const PICKERS = ["Tom", "Lars", "Sem", "Daan", "Bram", "Niek", "Ruben", "Joost", "Tim", "Stijn", "Koen", "Bas", "Mark", "Jeroen", "Pim", "Thijs", "Wouter", "Gijs", "Rik", "Sven"];
function pickerName(branchId: string): string {
  let h = 0;
  for (const c of String(branchId || "0")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PICKERS[h % PICKERS.length];
}

/** Stap 2-tekst: noemt direct wie + welke winkel je bestelling inpakt (of split). */
function sourceSentence(plan: FulfillmentPlan | null, t: Tr) {
  const tail = <> {t("order.tracking_note")}</>;
  if (!plan?.shipments?.length) return <>{t("order.packing_care")}{tail}</>;
  if (plan.splitCount > 1) {
    const locs = [...new Set(plan.shipments.map((s) => (s.isWarehouse ? t("order.warehouse") : s.store.replace(/^GENTS\s+/i, ""))))].join(` ${t("common.and")} `);
    return <>{t("order.from_locations")} {locs} {t("order.split_shipments")} {plan.splitCount} {t("order.shipments_label")}{tail}</>;
  }
  const s = plan.shipments[0];
  if (s.isWarehouse) return <>{t("order.warehouse_packing")}{tail}</>;
  return <><span className="text-ink">{pickerName(s.branchId)}</span> {t("order.picker_in_store")} <span className="text-ink">{s.store.replace(/^GENTS\s+/i, "")}</span> {t("order.picker_packing")}{tail}</>;
}

/** Eén stap in het "wat er nu gebeurt"-stappenplan (Coolblue-stijl). */
function Step({ done, title, body }: { done?: boolean; title: string; body: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${done ? "bg-ink text-canvas" : "border border-line text-ink"}`}>
        {done ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M5 12l5 5 9-9" strokeLinecap="round" strokeLinejoin="round" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><circle cx="12" cy="12" r="9" /></svg>
        )}
      </span>
      <div className="min-w-0">
        <p className="font-sans text-sm font-medium text-ink">{title}</p>
        <p className="mt-0.5 font-sans text-sm leading-relaxed text-ink-soft">{body}</p>
      </div>
    </li>
  );
}

export default async function OrderPage({ params, searchParams }: Props) {
  const { orderNumber } = await params;
  const { t: token } = await searchParams;
  const locale = await getLocale();
  const t = await getT(locale);
  // IDOR-bescherming: alleen tonen met geldig access-token (gast) of als eigenaar.
  const customer = await getSessionCustomer();
  const data = await getOrderForViewer(orderNumber, { token, customerId: customer?.id });
  if (!data) notFound();
  const { order, lines } = data;

  const paid = order.status === "paid";
  const pending = order.status === "open";
  const failed = ["failed", "expired", "canceled"].includes(order.status);

  // Post-purchase: verzorgingstips + cross-sell (alleen bij een betaalde order).
  const extras = paid ? await getPostPurchase(lines.map((l) => l.productHandle)) : null;

  // Bezorgschatting voor het stappenplan.
  const settings = paid ? await getSettings() : null;
  const isExpress = order.deliveryMethod === "express";
  const deliveryDate = settings
    ? addBusinessDays(new Date(order.createdAt), isExpress ? Math.max(1, settings.expressTransitDays) : settings.standardMaxDays)
    : null;

  // Fulfilment-routing voor de bevestiging: welke winkel(s)/magazijn pakt wat in,
  // en of het in meerdere zendingen komt. Gebruik het opgeslagen plan; anders live.
  let plan: FulfillmentPlan | null = null;
  if (paid) {
    const stored = order.fulfillmentPlan as FulfillmentPlan | null;
    plan = stored?.shipments?.length
      ? stored
      : await allocateOrder(
          lines.map((l) => ({ sku: l.sku, qty: l.quantity, title: l.title, groupId: l.groupId ?? undefined })),
          { country: order.country, postalCode: order.postalCode },
        ).catch(() => null);
  }

  return (
    <div className="mx-auto max-w-2xl px-gutter py-16">
      {paid ? <ClearCart /> : null}
      {paid ? <TrackPurchase orderNumber={order.orderNumber} totalCents={order.totalCents} /> : null}

      {paid ? (
        <>
          <p className="label-brand">{order.firstName ? t("order.thanks_name", { name: order.firstName }) : t("order.thanks")}</p>
          <h1 className="mt-2 text-display-md">{t("order.confirmed_title")}</h1>
          <p className="mt-3 font-sans text-ink-soft">
            {t("order.confirmation_sent")} {order.email}.
          </p>
          {/* Stappenplan — wat er nu gebeurt (Coolblue-stijl). */}
          <section className="mt-8 rounded-card border border-line bg-surface/50 p-5">
            <p className="label-brand">{t("order.what_happens_next")}</p>
            <ol className="mt-4 space-y-4">
              <Step done title={t("order.step_payment_received")} body={<>{t("order.confirmation_details")} <span className="text-ink">{order.email}</span>.</>} />
              <Step title={t("order.step_prepare")} body={sourceSentence(plan, t)} />
              <Step
                title={isExpress ? t("order.step_express") : t("order.step_delivered")}
                body={deliveryDate ? <>{t("order.expected_delivery")} <span className="text-ink">{fmtDate(deliveryDate, locale)}</span>. {t("order.not_home_note")}</> : t("order.delivery_asap")}
              />
            </ol>
          </section>
        </>
      ) : pending ? (
        <>
          <p className="label-brand">{t("order.pending_eyebrow")}</p>
          <h1 className="mt-2 text-display-md">{t("order.confirming_title")}</h1>
          <p className="mt-3 font-sans text-ink-soft">
            {t("order.processing_note")}
          </p>
          <OrderStatusPoller orderNumber={order.orderNumber} token={token} />
        </>
      ) : failed ? (
        <>
          <p className="label-brand">{t("order.payment_failed_eyebrow")}</p>
          <h1 className="mt-2 text-display-md">{t("order.payment_failed_title")}</h1>
          <p className="mt-3 font-sans text-ink-soft">
            {t("order.payment_failed_note")}
          </p>
          <Link href="/afrekenen" className="btn-primary mt-6">
            {t("order.retry_checkout")}
          </Link>
        </>
      ) : null}

      <div className="mt-8 border-y border-line py-5">
        <p className="font-sans text-sm text-muted">{t("order.order_number")}</p>
        <p className="font-display text-lg">{order.orderNumber}</p>
        {order.companyName ? (
          <p className="mt-2 font-sans text-sm text-ink-soft">
            {t("order.business_order")} <span className="text-ink">{order.companyName}</span>
            {order.vatNumber ? ` · ${t("order.vat")} ${order.vatNumber}` : ""}
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
                {[l.color, l.size && t("cart.added.sizeMeta", { size: l.size }), `${l.quantity}×`].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span>{formatEuro(l.unitPriceCents * l.quantity)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-4 space-y-1.5 font-sans text-sm">
        <div className="flex justify-between"><dt className="text-muted">{t("checkout.subtotal")}</dt><dd>{formatEuro(order.subtotalCents)}</dd></div>
        {order.discountCents > 0 ? (<div className="flex justify-between text-success"><dt>{t("checkout.discount")}{order.voucherCode ? ` (${order.voucherCode})` : ""}</dt><dd>− {formatEuro(order.discountCents)}</dd></div>) : null}
        <div className="flex justify-between"><dt className="text-muted">{t("checkout.shipping")}</dt><dd>{order.shippingCents === 0 ? t("checkout.free") : formatEuro(order.shippingCents)}</dd></div>
        {order.giftcardCents > 0 ? (<div className="flex justify-between text-success"><dt>{t("checkout.giftcard_label")}</dt><dd>− {formatEuro(order.giftcardCents)}</dd></div>) : null}
        <div className="flex justify-between border-t border-line pt-2 font-medium"><dt>{order.giftcardCents > 0 ? t("order.paid_label") : t("checkout.total")}</dt><dd className="font-display text-lg">{formatEuro(order.totalCents)}</dd></div>
      </dl>

      {paid && plan && plan.splitCount > 1 ? (
        <section className="mt-10">
          <p className="label-brand">{t("order.shipments_title_count", { count: plan.splitCount })}</p>
          <h2 className="mt-2 font-display text-xl">{t("order.multiple_shipments_note")}</h2>
          <p className="mt-1 font-sans text-sm text-ink-soft">{t("order.shipments_note")}</p>
          <div className="mt-5 space-y-3">
            {plan.shipments.map((s, i) => (
              <div key={i} className="flex items-start gap-4 rounded-card border border-line p-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-ink">
                  {s.isWarehouse ? (
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M3 9l9-5 9 5v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9z" strokeLinecap="round" strokeLinejoin="round" /><path d="M8 21V12h8v9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M3 9l1.5-4.5h15L21 9M3 9v10a1 1 0 001 1h16a1 1 0 001-1V9M3 9h18M9 14h6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-sans text-sm font-medium text-ink">
                    {plan.splitCount > 1 ? `${t("order.shipment")} ${i + 1} ${t("order.of_label")} ${plan.splitCount} · ` : ""}
                    {s.isWarehouse ? t("order.from_warehouse") : `${t("order.from_store")} ${s.store.replace(/^GENTS\s+/i, "")}`}
                  </p>
                  <p className="mt-0.5 font-sans text-sm text-ink-soft">
                    {s.isWarehouse ? t("order.warehouse_makes") : `${pickerName(s.branchId)} ${t("order.picker_makes")}`} {s.units === 1 ? t("order.your_item") : t("order.your_items_count", { count: s.units })} {t("order.ready_with_care")}
                  </p>
                  <ul className="mt-1.5 font-sans text-xs text-muted">
                    {s.lines.map((l, j) => (
                      <li key={j}>{l.title || l.sku}{l.qty > 1 ? ` · ${l.qty}×` : ""}</li>
                    ))}
                  </ul>
                  {s.dispatchLabel ? <p className="mt-1.5 font-sans text-xs text-ink-soft">{s.dispatchLabel}</p> : null}
                </div>
              </div>
            ))}
          </div>
          {!plan.fullyAllocated ? (
            <p className="mt-3 font-sans text-xs text-muted">{t("order.partial_shipment_note")}</p>
          ) : null}
        </section>
      ) : null}

      {paid ? (
        <div className="mt-8 flex flex-col items-start gap-2 rounded-card bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-sans text-sm text-ink-soft">
            <span className="font-medium text-ink">{t("order.happy_with_purchase")}</span> {t("order.help_review")}
          </p>
          <Link href={`/review/${order.orderNumber}${token ? `?t=${token}` : ""}`} className="btn-ghost shrink-0">
            {t("order.write_review")}
          </Link>
        </div>
      ) : null}

      {paid ? (
        <section className="mt-12 border-t border-line pt-8">
          <p className="label-brand">{t("order.enjoy_long_title")}</p>
          <h2 className="mt-2 font-display text-xl">{t("order.care_tips_title")}</h2>
          <ul className="mt-4 space-y-2.5 font-sans text-sm leading-relaxed text-ink-soft">
            <li className="flex gap-2"><span aria-hidden className="text-ink">·</span><span>{t("order.unpack_prefix")} <span className="text-ink">{t("order.hang_immediately")}</span> — {t("order.creases_note")}</span></li>
            <li className="flex gap-2"><span aria-hidden className="text-ink">·</span><span><span className="text-ink">{t("order.fit_question")}</span> {t("order.with_our")} <span className="text-ink">{t("order.alteration_service")}</span> {t("order.alteration_details")} <span className="text-ink">{t("order.free_return")}</span> — {t("order.return_in_store")}</span></li>
          </ul>
          {extras?.careItems.length ? (
            <>
              <p className="mt-6 font-sans text-sm font-medium text-ink">{t("order.care_title")}</p>
              <div className="mt-3"><CareBlock items={extras.careItems} prose={[]} /></div>
            </>
          ) : null}
        </section>
      ) : null}

      {paid && !order.customerId ? (
        <section className="mt-10 flex flex-col items-start gap-3 rounded-card bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-lg">{t("order.create_account_points_title")}</p>
            <p className="mt-1 font-sans text-sm text-ink-soft">{t("order.points_auto_note")} {t("order.create_account_note")}</p>
          </div>
          <Link href="/account/login" className="btn-primary shrink-0">{t("order.create_account")}</Link>
        </section>
      ) : null}

      {paid && extras?.recommendations.length ? (
        <section className="mt-12">
          <p className="label-brand">{t("order.complete_outfit_label")}</p>
          <h2 className="mt-2 font-display text-xl">{t("order.wear_with_title")}</h2>
          <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
            {extras.recommendations.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : null}

      {paid ? (
        <section className="mt-12 grid gap-4 sm:grid-cols-2">
          <div className="rounded-card border border-line p-5">
            <p className="font-display text-lg">{t("order.questions_title")}</p>
            <p className="mt-1 font-sans text-sm text-ink-soft">{t("order.service_note")}</p>
            <Link href="/winkels" className="mt-3 inline-block font-sans text-sm text-ink underline underline-offset-4">{t("order.find_store")}</Link>
          </div>
          <div className="rounded-card border border-line p-5">
            <p className="font-display text-lg">{t("order.track_order_title")}</p>
            <p className="mt-1 font-sans text-sm text-ink-soft">
              {order.customerId
                ? t("order.track_in_account")
                : t("order.track_via_page")}
            </p>
            {order.customerId ? <Link href="/account" className="mt-3 inline-block font-sans text-sm text-ink underline underline-offset-4">{t("order.to_account")}</Link> : null}
          </div>
        </section>
      ) : null}

      <div className="mt-12 flex flex-wrap items-center gap-3">
        <Link href="/" className="btn-ghost">
          {t("common.continue_shopping")}
        </Link>
        {paid ? <ReorderButton orderNumber={order.orderNumber} token={token} /> : null}
      </div>
    </div>
  );
}
