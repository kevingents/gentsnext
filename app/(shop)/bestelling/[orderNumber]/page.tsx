import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderForViewer, getPostPurchase } from "@/lib/orders";
import { getSettings } from "@/lib/settings";
import { allocateOrder, type FulfillmentPlan } from "@/lib/fulfillment";
import { getSessionCustomer } from "@/lib/account";
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
function fmtDate(d: Date): string {
  return d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
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
function sourceSentence(plan: FulfillmentPlan | null) {
  const tail = <> Zodra je pakket onderweg is, krijg je een verzendmail met track &amp; trace zodat je het kunt volgen.</>;
  if (!plan?.shipments?.length) return <>We pakken je bestelling met zorg in.{tail}</>;
  if (plan.splitCount > 1) {
    const locs = [...new Set(plan.shipments.map((s) => (s.isWarehouse ? "ons magazijn" : s.store.replace(/^GENTS\s+/i, ""))))].join(" en ");
    return <>Je bestelling komt uit {locs} en wordt in {plan.splitCount} zendingen verstuurd.{tail}</>;
  }
  const s = plan.shipments[0];
  if (s.isWarehouse) return <>Ons magazijnteam pakt je bestelling met zorg in.{tail}</>;
  return <><span className="text-ink">{pickerName(s.branchId)}</span> in onze winkel in <span className="text-ink">{s.store.replace(/^GENTS\s+/i, "")}</span> pakt je bestelling met zorg in.{tail}</>;
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
          <p className="label-brand">Bedankt, {order.firstName || "voor je bestelling"}</p>
          <h1 className="mt-2 text-display-md">Je bestelling is bevestigd</h1>
          <p className="mt-3 font-sans text-ink-soft">
            We hebben je betaling ontvangen. Een bevestiging is onderweg naar {order.email}.
          </p>
          {/* Stappenplan — wat er nu gebeurt (Coolblue-stijl). */}
          <section className="mt-8 rounded-card border border-line bg-surface/50 p-5">
            <p className="label-brand">Wat er nu gebeurt</p>
            <ol className="mt-4 space-y-4">
              <Step done title="Betaling ontvangen" body={<>Je orderbevestiging met factuur is onderweg naar <span className="text-ink">{order.email}</span>.</>} />
              <Step title="We maken je bestelling klaar" body={sourceSentence(plan)} />
              <Step
                title={isExpress ? "Snel bezorgd" : "Bezorgd"}
                body={deliveryDate ? <>Verwachte bezorging rond <span className="text-ink">{fmtDate(deliveryDate)}</span>. Niet thuis? De bezorger probeert het opnieuw of levert bij de buren.</> : "We bezorgen je bestelling zo snel mogelijk."}
              />
            </ol>
          </section>
        </>
      ) : pending ? (
        <>
          <p className="label-brand">Even geduld</p>
          <h1 className="mt-2 text-display-md">We bevestigen je betaling</h1>
          <p className="mt-3 font-sans text-ink-soft">
            Je betaling wordt verwerkt. Je ontvangt ook een bevestiging per e-mail.
          </p>
          <OrderStatusPoller orderNumber={order.orderNumber} token={t} />
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
        {order.discountCents > 0 ? (<div className="flex justify-between text-success"><dt>Korting{order.voucherCode ? ` (${order.voucherCode})` : ""}</dt><dd>− {formatEuro(order.discountCents)}</dd></div>) : null}
        <div className="flex justify-between"><dt className="text-muted">Verzending</dt><dd>{order.shippingCents === 0 ? "Gratis" : formatEuro(order.shippingCents)}</dd></div>
        {order.giftcardCents > 0 ? (<div className="flex justify-between text-success"><dt>Cadeaubon</dt><dd>− {formatEuro(order.giftcardCents)}</dd></div>) : null}
        <div className="flex justify-between border-t border-line pt-2 font-medium"><dt>{order.giftcardCents > 0 ? "Betaald" : "Totaal"}</dt><dd className="font-display text-lg">{formatEuro(order.totalCents)}</dd></div>
      </dl>

      {paid && plan && plan.splitCount > 1 ? (
        <section className="mt-10">
          <p className="label-brand">Je bestelling — {plan.splitCount} zendingen</p>
          <h2 className="mt-2 font-display text-xl">We versturen je bestelling in meerdere zendingen</h2>
          <p className="mt-1 font-sans text-sm text-ink-soft">Je artikelen komen uit verschillende locaties en worden los bezorgd — je betaalt niets extra.</p>
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
                    {plan.splitCount > 1 ? `Zending ${i + 1} van ${plan.splitCount} · ` : ""}
                    {s.isWarehouse ? "Vanuit ons magazijn" : `Onze winkel in ${s.store.replace(/^GENTS\s+/i, "")}`}
                  </p>
                  <p className="mt-0.5 font-sans text-sm text-ink-soft">
                    {s.isWarehouse ? "Ons magazijnteam maakt" : `${pickerName(s.branchId)} maakt`} {s.units === 1 ? "je artikel" : `je ${s.units} artikelen`} met zorg klaar.
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
            <p className="mt-3 font-sans text-xs text-muted">Een enkel artikel volgt mogelijk iets later na — we houden je per e-mail op de hoogte.</p>
          ) : null}
        </section>
      ) : null}

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

      {paid ? (
        <section className="mt-12 border-t border-line pt-8">
          <p className="label-brand">Zo geniet je er lang van</p>
          <h2 className="mt-2 font-display text-xl">Verzorgingstips voor je aankoop</h2>
          <ul className="mt-4 space-y-2.5 font-sans text-sm leading-relaxed text-ink-soft">
            <li className="flex gap-2"><span aria-hidden className="text-ink">·</span><span>Pak je bestelling uit en <span className="text-ink">hang de kleding meteen uit</span> — vouw- en verzendkreukels hangen er dan vanzelf uit. Een nacht laten hangen helpt; eventueel licht stomen of strijken op lage temperatuur.</span></li>
            <li className="flex gap-2"><span aria-hidden className="text-ink">·</span><span><span className="text-ink">Past iets niet helemaal?</span> Met onze <span className="text-ink">vermaakservice</span> in de winkel maken we mouwen, pijpen en taille passend. Liever ruilen of retourneren? Dat kan <span className="text-ink">gratis binnen 14 dagen</span> — ook in de winkel.</span></li>
          </ul>
          {extras?.careItems.length ? (
            <>
              <p className="mt-6 font-sans text-sm font-medium text-ink">Onderhoud van dit artikel</p>
              <div className="mt-3"><CareBlock items={extras.careItems} prose={[]} /></div>
            </>
          ) : null}
        </section>
      ) : null}

      {paid && !order.customerId ? (
        <section className="mt-10 flex flex-col items-start gap-3 rounded-card bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-lg">Maak een account aan en spaar punten</p>
            <p className="mt-1 font-sans text-sm text-ink-soft">De spaarpunten van deze bestelling worden automatisch bijgeschreven. Volg je bestelling, bewaar je maten en bestel een volgende keer sneller.</p>
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

      {paid ? (
        <section className="mt-12 grid gap-4 sm:grid-cols-2">
          <div className="rounded-card border border-line p-5">
            <p className="font-display text-lg">Vragen over je bestelling?</p>
            <p className="mt-1 font-sans text-sm text-ink-soft">Onze klantenservice en stylisten in 19 winkels helpen je graag verder.</p>
            <Link href="/winkels" className="mt-3 inline-block font-sans text-sm text-ink underline underline-offset-4">Vind een winkel</Link>
          </div>
          <div className="rounded-card border border-line p-5">
            <p className="font-display text-lg">Volg je bestelling</p>
            <p className="mt-1 font-sans text-sm text-ink-soft">
              {order.customerId
                ? "Je vindt deze bestelling en de status altijd terug in je account."
                : "Bewaar deze pagina — hiermee volg je de status van je bestelling."}
            </p>
            {order.customerId ? <Link href="/account" className="mt-3 inline-block font-sans text-sm text-ink underline underline-offset-4">Naar mijn account</Link> : null}
          </div>
        </section>
      ) : null}

      <div className="mt-12 flex flex-wrap items-center gap-3">
        <Link href="/" className="btn-ghost">
          Verder winkelen
        </Link>
        {paid ? <ReorderButton orderNumber={order.orderNumber} token={t} /> : null}
      </div>
    </div>
  );
}
