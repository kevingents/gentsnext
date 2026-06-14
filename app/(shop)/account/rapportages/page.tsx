import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { parseRange, getKpis, topProducts, revenueByCategory, topCustomers, voucherGiftcardImpact, newsletterStats, reviewStats, retentionReport, returnsReport } from "@/lib/reports";
import { BackofficeShell, Section, RangeForm, euro } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rapportages", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ from?: string; to?: string }> };

export default async function RapportagesPage({ searchParams }: Props) {
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
  const [kpi, prods, cats, custs, promo, news, reviews, retention, returns] = await Promise.all([
    getKpis(r), topProducts(r, 50), revenueByCategory(r), topCustomers(50), voucherGiftcardImpact(r), newsletterStats(), reviewStats(), retentionReport(), returnsReport(r),
  ]);

  const onlineAov = kpi.orders ? Math.round(kpi.revenueCents / kpi.orders) : 0;
  const storeAov = kpi.storeOrders ? Math.round(kpi.storeRevenueCents / kpi.storeOrders) : 0;

  return (
    <BackofficeShell active="/account/rapportages" title="Rapportages">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-pslate">Periode {sp.from || "—"} t/m {sp.to || "vandaag"}</p>
        <RangeForm from={r.from} to={r.to} action="/account/rapportages" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Kanaalvergelijking — online vs winkel">
          <table className="w-full border-collapse font-sans text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted"><th className="py-1.5">Kanaal</th><th className="py-1.5 text-right">Orders</th><th className="py-1.5 text-right">Omzet</th><th className="py-1.5 text-right">AOV</th></tr></thead>
            <tbody>
              <tr className="border-b border-line/60"><td className="py-1.5">Webshop</td><td className="py-1.5 text-right tabular-nums">{kpi.orders.toLocaleString("nl-NL")}</td><td className="py-1.5 text-right tabular-nums">{euro(kpi.revenueCents)}</td><td className="py-1.5 text-right tabular-nums">{euro(onlineAov)}</td></tr>
              <tr><td className="py-1.5">Winkel</td><td className="py-1.5 text-right tabular-nums">{kpi.storeOrders.toLocaleString("nl-NL")}</td><td className="py-1.5 text-right tabular-nums">{euro(kpi.storeRevenueCents)}</td><td className="py-1.5 text-right tabular-nums">{euro(storeAov)}</td></tr>
            </tbody>
          </table>
        </Section>

        <Section title="Acties, tegoed & marketing">
          <dl className="space-y-1.5 font-sans text-sm">
            <Row label="Voucher-korting (periode)" value={euro(promo.discountCents)} />
            <Row label="Cadeaubonnen verkocht" value={`${promo.giftcardsSold} · ${euro(promo.giftcardsInitialCents)}`} />
            <Row label="Cadeaubon-saldo openstaand" value={euro(promo.giftcardsActiveCents)} />
            <Row label="Nieuwsbrief (e-mail / WhatsApp)" value={`${news.email.toLocaleString("nl-NL")} / ${news.whatsapp.toLocaleString("nl-NL")}`} />
            <Row label="Reviews (online / gem.)" value={`${reviews.published} / ${reviews.avg}`} />
          </dl>
        </Section>
      </div>

      <div className="mt-5">
        <Section title="Omzet per categorie">
          <table className="w-full border-collapse font-sans text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted"><th className="py-1.5">Categorie</th><th className="py-1.5 text-right">Artikelen</th><th className="py-1.5 text-right">Omzet</th></tr></thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.category} className="border-b border-line/60"><td className="py-1.5">{c.category}</td><td className="py-1.5 text-right tabular-nums">{c.qty.toLocaleString("nl-NL")}</td><td className="py-1.5 text-right tabular-nums">{euro(c.revenueCents)}</td></tr>
              ))}
              {!cats.length ? <tr><td colSpan={3} className="py-4 text-center text-muted">Geen data.</td></tr> : null}
            </tbody>
          </table>
        </Section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Section title="Retentie — herhaalaankopen (all-time)">
          <dl className="mb-3 grid grid-cols-3 gap-3 font-sans text-sm">
            <div><dt className="text-xs uppercase tracking-wide text-muted">Klanten</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums text-pnavy">{retention.overall.customers.toLocaleString("nl-NL")}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">Herhaalkopers</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums text-pnavy">{retention.overall.repeatPct}%</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">Orders/klant</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums text-pnavy">{retention.overall.avgOrders}</dd></div>
          </dl>
          <div className="max-h-[22rem] overflow-y-auto">
            <table className="w-full border-collapse font-sans text-sm">
              <thead className="sticky top-0 bg-canvas"><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted"><th className="py-1.5">Cohort (1e order)</th><th className="py-1.5 text-right">Klanten</th><th className="py-1.5 text-right">Herhaal</th><th className="py-1.5 text-right">Orders/kl.</th></tr></thead>
              <tbody>
                {retention.cohorts.map((c) => (
                  <tr key={c.cohort} className="border-b border-line/60"><td className="py-1.5 tabular-nums">{c.cohort}</td><td className="py-1.5 text-right tabular-nums">{c.customers.toLocaleString("nl-NL")}</td><td className="py-1.5 text-right tabular-nums">{c.repeatPct}%</td><td className="py-1.5 text-right tabular-nums">{c.avgOrders}</td></tr>
                ))}
                {!retention.cohorts.length ? <tr><td colSpan={4} className="py-4 text-center text-muted">Geen data.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Retouren (periode)">
          <dl className="mb-3 grid grid-cols-3 gap-3 font-sans text-sm">
            <div><dt className="text-xs uppercase tracking-wide text-muted">Retouren</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums text-pnavy">{returns.count.toLocaleString("nl-NL")}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">Retourwaarde</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums text-pnavy">{euro(returns.valueCents)}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">Retourpercentage</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums text-pnavy">{returns.ratePct}%</dd></div>
          </dl>
          {returns.topCategories.length ? (
            <table className="w-full border-collapse font-sans text-sm">
              <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted"><th className="py-1.5">Meest geretourneerd</th><th className="py-1.5 text-right">Artikelen</th><th className="py-1.5 text-right">Orders</th></tr></thead>
              <tbody>
                {returns.topCategories.map((c) => (
                  <tr key={c.category} className="border-b border-line/60"><td className="py-1.5"><span className="block max-w-[16rem] truncate">{c.category}</span></td><td className="py-1.5 text-right tabular-nums">{c.qty.toLocaleString("nl-NL")}</td><td className="py-1.5 text-right tabular-nums">{c.orders}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="font-sans text-sm text-muted">Geen retouren in deze periode.</p>}
        </Section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Section title="Top 50 producten (omzet)">
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="w-full border-collapse font-sans text-sm">
              <thead className="sticky top-0 bg-canvas"><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted"><th className="py-1.5 pr-2">Product</th><th className="py-1.5 text-right">Aantal</th><th className="py-1.5 pl-2 text-right">Omzet</th></tr></thead>
              <tbody>
                {prods.map((p, i) => (
                  <tr key={p.sku + i} className="border-b border-line/60"><td className="py-1.5 pr-2"><span className="block max-w-[18rem] truncate">{p.title}</span></td><td className="py-1.5 text-right tabular-nums">{p.qty.toLocaleString("nl-NL")}</td><td className="py-1.5 pl-2 text-right tabular-nums">{euro(p.revenueCents)}</td></tr>
                ))}
                {!prods.length ? <tr><td colSpan={3} className="py-4 text-center text-muted">Geen verkopen.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Top 50 klanten (besteed, all-time)">
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="w-full border-collapse font-sans text-sm">
              <thead className="sticky top-0 bg-canvas"><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted"><th className="py-1.5 pr-2">Klant</th><th className="py-1.5 text-right">Orders</th><th className="py-1.5 pl-2 text-right">Besteed</th></tr></thead>
              <tbody>
                {custs.map((c) => (
                  <tr key={c.id} className="border-b border-line/60"><td className="py-1.5 pr-2"><Link href={`/account/klanten/${c.id}`} className="block max-w-[16rem] truncate hover:underline">{c.name || c.email}</Link></td><td className="py-1.5 text-right tabular-nums">{c.orders}</td><td className="py-1.5 pl-2 text-right tabular-nums">{euro(c.spentCents)}</td></tr>
                ))}
                {!custs.length ? <tr><td colSpan={3} className="py-4 text-center text-muted">Geen klanten.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </BackofficeShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-pslate">{label}</dt>
      <dd className="tabular-nums text-pnavy">{value}</dd>
    </div>
  );
}
