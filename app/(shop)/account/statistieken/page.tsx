import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import {
  parseRange, getKpis, revenueByDay, topProducts, revenueByCategory,
  statusDistribution, voucherGiftcardImpact, newsletterStats, reviewStats, funnel,
} from "@/lib/reports";
import { AdminNav, Kpi, BarList, DayBars, RangeForm, Section, euro } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Statistieken", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ from?: string; to?: string }> };

export default async function StatistiekenPage({ searchParams }: Props) {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");
  if (!customer.isAdmin) {
    return (
      <div className="mx-auto max-w-page px-gutter py-16">
        <h1 className="text-display-md">Geen toegang</h1>
        <Link href="/account" className="mt-6 inline-block font-sans text-sm text-ink underline">← Terug</Link>
      </div>
    );
  }

  const sp = await searchParams;
  const r = parseRange(sp);
  const [kpi, byDay, top, cats, status, promo, news, reviews, fun] = await Promise.all([
    getKpis(r), revenueByDay(r), topProducts(r, 12), revenueByCategory(r),
    statusDistribution(r), voucherGiftcardImpact(r), newsletterStats(), reviewStats(), funnel(30),
  ]);

  const fmtPct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  return (
    <div className="mx-auto max-w-page px-gutter py-10">
      <p className="label-brand">Beheer</p>
      <h1 className="mt-2 text-display-md">Statistieken</h1>
      <div className="mt-6"><AdminNav active="/account/statistieken" /></div>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <p className="font-sans text-sm text-muted">Periode {sp.from || "—"} t/m {sp.to || "vandaag"} · online webshop-orders</p>
        <RangeForm from={r.from} to={r.to} action="/account/statistieken" />
      </div>

      {/* KPI's */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Omzet (online)" value={euro(kpi.revenueCents)} sub={`${kpi.orders.toLocaleString("nl-NL")} orders`} accent />
        <Kpi label="Gem. orderwaarde" value={euro(kpi.aovCents)} sub={`${kpi.itemsSold.toLocaleString("nl-NL")} artikelen`} />
        <Kpi label="Winkelomzet" value={euro(kpi.storeRevenueCents)} sub={`${kpi.storeOrders.toLocaleString("nl-NL")} winkelaankopen`} />
        <Kpi label="Nieuwe klanten" value={kpi.newCustomers.toLocaleString("nl-NL")} sub="in periode" />
        <Kpi label="Terugbetaald" value={euro(kpi.refundCents)} sub={`${kpi.refundOrders} orders`} />
        <Kpi label="Kortingen" value={euro(kpi.discountCents)} sub="vouchers" />
        <Kpi label="Cadeaubon ingewisseld" value={euro(kpi.giftcardCents)} />
        <Kpi label="Omzet/klant (nieuw)" value={kpi.newCustomers ? euro(Math.round(kpi.revenueCents / kpi.newCustomers)) : "—"} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title="Omzet per dag">
            <DayBars data={byDay} />
          </Section>
        </div>
        <Section title="Order-status">
          <BarList items={status.map((s) => ({ label: s.status, value: s.n, sub: euro(s.revenueCents) }))} />
        </Section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Section title="Omzet per categorie">
          <BarList money items={cats.slice(0, 12).map((c) => ({ label: c.category, value: c.revenueCents, sub: `${c.qty}×` }))} />
        </Section>
        <Section title="Best verkochte producten">
          <BarList money items={top.map((t) => ({ label: t.title, value: t.revenueCents, sub: `${t.qty}×` }))} />
        </Section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Section title="Acties & tegoed">
          <dl className="space-y-1.5 font-sans text-sm">
            <Row label="Voucher-omzet (korting)" value={euro(promo.discountCents)} />
            <Row label="Cadeaubonnen verkocht" value={`${promo.giftcardsSold} · ${euro(promo.giftcardsInitialCents)}`} />
            <Row label="Cadeaubon-saldo actief" value={euro(promo.giftcardsActiveCents)} />
            <Row label="Cadeaubon ingewisseld" value={euro(promo.giftcardRedeemedCents)} />
          </dl>
        </Section>
        <Section title="Nieuwsbrief & reviews">
          <dl className="space-y-1.5 font-sans text-sm">
            <Row label="Nieuwsbrief e-mail" value={news.email.toLocaleString("nl-NL")} />
            <Row label="Nieuwsbrief WhatsApp" value={news.whatsapp.toLocaleString("nl-NL")} />
            <Row label="Reviews online" value={`${reviews.published} · gem. ${reviews.avg}`} />
            <Row label="Reviews te modereren" value={reviews.pending.toLocaleString("nl-NL")} />
          </dl>
        </Section>
        <Section title="Webshop-funnel (30 dagen)">
          <BarList
            items={[
              { label: "Productweergaven", value: fun.productView },
              { label: "In winkelwagen", value: fun.addToCart, sub: fmtPct(fun.addToCart, fun.productView) },
              { label: "Checkout gestart", value: fun.checkoutStart, sub: fmtPct(fun.checkoutStart, fun.addToCart) },
              { label: "Aankoop", value: fun.purchase, sub: fmtPct(fun.purchase, fun.checkoutStart) },
            ]}
          />
        </Section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
