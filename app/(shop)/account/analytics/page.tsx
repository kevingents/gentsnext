import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { getDashboard } from "@/lib/analytics";
import { getProductsByHandles } from "@/lib/catalog";
import { BackofficeShell } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Analytics", robots: { index: false, follow: false } };

export default async function AnalyticsPage() {
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

  const d = await getDashboard(30);
  const cards = await getProductsByHandles(d.topProducts.map((p) => p.handle));
  const titleByHandle = new Map(cards.map((c) => [c.handle, c.title]));

  const count = (t: string) => d.counts.find((c) => c.type === t)?.n ?? 0;
  const fView = d.funnel.product_view ?? 0;
  const fCart = d.funnel.add_to_cart ?? 0;
  const fCheckout = d.funnel.checkout_start ?? 0;
  const fBuy = d.funnel.purchase ?? 0;
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

  return (
    <BackofficeShell active="/account/analytics" title="Funnel & analytics">
      <p className="font-sans text-sm text-pslate">Laatste {d.days} dagen · anoniem, eigen data</p>

      {/* Kerncijfers */}
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Bekeken producten" value={count("product_view")} />
        <Stat label="In winkelwagen" value={count("add_to_cart")} />
        <Stat label="Checkouts gestart" value={count("checkout_start")} />
        <Stat label="Aankopen" value={count("purchase")} />
      </div>

      {/* Funnel */}
      <section className="mt-10">
        <p className="label-brand mb-3">Conversie-funnel (unieke sessies)</p>
        <div className="space-y-2">
          <FunnelRow label="Product bekeken" value={fView} base={fView} />
          <FunnelRow label="In winkelwagen" value={fCart} base={fView} note={`${pct(fCart, fView)}% van bekeken`} />
          <FunnelRow label="Checkout gestart" value={fCheckout} base={fView} note={`${pct(fCheckout, fCart)}% van winkelwagen`} />
          <FunnelRow label="Aankoop" value={fBuy} base={fView} note={`${pct(fBuy, fCheckout)}% van checkout`} />
        </div>
      </section>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <List
          title="Meest bekeken producten"
          rows={d.topProducts.map((p) => ({ label: titleByHandle.get(p.handle) || p.handle, n: p.n, href: `/products/${p.handle}` }))}
        />
        <List title="Populairste zoektermen" rows={d.topSearches.map((s) => ({ label: s.query, n: s.n }))} />
        <List
          title="Zoekopdrachten zónder resultaat (afhakers)"
          rows={d.noResults.map((s) => ({ label: s.query, n: s.n }))}
          empty="Geen — iedereen vindt wat hij zoekt."
          danger
        />
        <List title="Activiteit per type" rows={d.counts.map((c) => ({ label: c.type, n: c.n }))} />
      </div>
    </BackofficeShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-line p-5">
      <p className="label-brand">{label}</p>
      <p className="mt-2 font-display text-3xl font-light">{value}</p>
    </div>
  );
}

function FunnelRow({ label, value, base, note }: { label: string; value: number; base: number; note?: string }) {
  const w = base > 0 ? Math.max(2, Math.round((value / base) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between font-sans text-sm">
        <span>{label}</span>
        <span className="text-muted">{value}{note ? ` · ${note}` : ""}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface">
        <div className="h-full bg-ink" style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

function List({ title, rows, empty, danger }: { title: string; rows: { label: string; n: number; href?: string }[]; empty?: string; danger?: boolean }) {
  return (
    <section>
      <p className="label-brand mb-3">{title}</p>
      {rows.length === 0 ? (
        <p className="font-sans text-sm text-muted">{empty || "Nog geen data."}</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center justify-between py-2.5 font-sans text-sm">
              {r.href ? (
                <Link href={r.href} className="truncate text-ink hover:underline">{r.label}</Link>
              ) : (
                <span className="truncate">{r.label}</span>
              )}
              <span className={danger ? "text-danger" : "text-muted"}>{r.n}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
