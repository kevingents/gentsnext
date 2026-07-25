import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { can } from "@/lib/permissions";
import { GeenToegang } from "@/components/account/geen-toegang";
import { getDashboard } from "@/lib/analytics";
import { getNavInsights } from "@/lib/nav-insights";
import { getProductsByHandles } from "@/lib/catalog";
import { BackofficeShell } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Analytics", robots: { index: false, follow: false } };

export default async function AnalyticsPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");
  if (!can(customer, "meten")) {
    return <GeenToegang permission="meten" />;
  }

  const [d, nav] = await Promise.all([getDashboard(30), getNavInsights(30)]);
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

      {/* Navigatie & lijstgedrag — waar klikt de klant écht, en wat zegt dat
          over menu, filters en ranking. */}
      <section className="mt-14 border-t border-line pt-10">
        <h2 className="font-display text-2xl font-light">Wat de klant aanklikt</h2>
        <p className="mt-1 font-sans text-sm text-pslate">
          {nav.totalNavClicks === 0
            ? "Nog geen navigatie-data. Deze meting is net toegevoegd; over een paar dagen staat hier waar mensen klikken."
            : `${nav.totalNavClicks} navigatie-kliks in ${nav.days} dagen.`}
        </p>

        <div className="mt-8 grid gap-10 lg:grid-cols-2">
          <List title="Meest geklikte menu-items" rows={nav.menu.map((m) => ({ label: m.label, n: m.clicks, href: m.href || undefined }))} />
          <List title="Meest geklikte categorietegels (home)" rows={nav.tiles.map((m) => ({ label: m.label, n: m.clicks }))} />
          <List
            title="Menu-items die niemand aanklikt"
            rows={nav.ongebruikteMenuItems.map((l) => ({ label: l, n: 0 }))}
            empty={nav.totalNavClicks < 25 ? "Te weinig data om dit te kunnen zeggen." : "Elk menu-item wordt gebruikt."}
            danger
          />
          <List title="Meest gekozen filters" rows={nav.filters.map((f) => ({ label: `${f.facet}: ${f.value}`, n: f.clicks }))} />
          <List title="Gekozen sortering" rows={nav.sorts.map((s) => ({ label: s.value, n: s.clicks }))} />
          <List
            title="Waar in de lijst wordt geklikt"
            rows={nav.clickPositions.map((p) => ({ label: p.bucket, n: p.clicks }))}
            empty="Nog geen kliks op productkaarten gemeten."
          />
          <List
            title="Gevraagd maar uitverkocht (inkoopsignaal)"
            rows={nav.gemisteMaten.map((s) => ({ label: `${s.handle} — maat ${s.size}`, n: s.clicks, href: `/products/${s.handle}` }))}
            empty="Geen klikken op uitverkochte maten."
            danger
          />
          <List
            title="Zoekopdrachten zonder resultaat"
            rows={nav.nulResultaten.map((r) => ({ label: r.query, n: r.n }))}
            empty="Iedereen vindt wat hij zoekt."
            danger
          />
        </div>
      </section>
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
