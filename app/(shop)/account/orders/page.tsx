import type { Metadata } from "next";
import { ORDER_STATUS_NL } from "@/lib/order-status";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { listOperationalOrders } from "@/lib/orders";
import type { FulfillmentPlan } from "@/lib/fulfillment";
import { listOrders } from "@/lib/reports";
import { OrdersAdmin } from "@/components/account/orders-admin";
import { BackofficeShell, Section, euro, StatusBadge, fieldClass, btnSecondary } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Orders", robots: { index: false, follow: false } };

const STATUSES = ["", "paid", "open", "shipped", "ready_pickup", "delivered", "refunded", "canceled", "failed", "expired"];
const STATUS_NL = ORDER_STATUS_NL; // gedeelde back-office-labels (lib/order-status)

type Props = { searchParams: Promise<{ q?: string; status?: string; channel?: string; from?: string; to?: string; page?: string }> };

/** Korte routing-samenvatting per order: welke locatie(s) + aantal zendingen. */
function routeSummary(plan: FulfillmentPlan | null): string {
  if (!plan?.shipments?.length) return "";
  const locs = plan.shipments.map((s) => (s.isWarehouse ? "Magazijn" : s.store.replace(/^GENTS\s+/i, "")));
  const base = [...new Set(locs)].join(" + ");
  return plan.splitCount > 1 ? `${base} · ${plan.splitCount} zendingen` : base;
}

export default async function OrdersPage({ searchParams }: Props) {
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
  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);
  const [opRows, list] = await Promise.all([
    listOperationalOrders(30),
    listOrders({
      search: sp.q,
      status: sp.status,
      channel: (sp.channel as "online" | "import" | "") || "",
      from: sp.from ? new Date(sp.from + "T00:00:00") : undefined,
      to: sp.to ? new Date(sp.to + "T23:59:59") : undefined,
      page,
      pageSize: 50,
    }),
  ]);

  const operational = opRows.map((o) => ({
    id: o.id, orderNumber: o.orderNumber, status: o.status, email: o.email,
    name: `${o.firstName} ${o.lastName}`.trim(), city: o.city, totalCents: o.totalCents,
    deliveryMethod: o.deliveryMethod, fulfillmentStatus: o.fulfillmentStatus, createdAt: o.createdAt.toISOString(),
    route: routeSummary(o.fulfillmentPlan as FulfillmentPlan | null),
  }));

  const totalPages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const qs = (p: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, status: sp.status, channel: sp.channel, from: sp.from, to: sp.to, ...p })) {
      if (v) u.set(k, String(v));
    }
    return `?${u.toString()}`;
  };
  const exportHref = (() => {
    const u = new URLSearchParams({ type: "orders" });
    for (const [k, v] of Object.entries({ q: sp.q, status: sp.status, channel: sp.channel, from: sp.from, to: sp.to })) if (v) u.set(k, String(v));
    return `/api/account/export?${u.toString()}`;
  })();

  return (
    <BackofficeShell active="/account/orders" title="Orders">
      {operational.length ? (
        <div>
          <Section title={`Te verwerken — ${operational.length} operationele orders`}>
            <p className="mb-3 text-xs text-pslate">Nieuwe webshop-orders (geen geïmporteerde historie). Een statuswijziging stuurt de klant een update.</p>
            <OrdersAdmin orders={operational} />
          </Section>
        </div>
      ) : null}

      <Section
        title={`Alle orders — ${list.total.toLocaleString("nl-NL")}`}
        right={<a href={exportHref} className={btnSecondary}>Exporteer CSV</a>}
      >
        {/* Filter (GET) */}
        <form method="get" action="/account/orders" className="mb-4 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-xs text-pslate">Zoek (nr/e-mail/naam/postcode)</span>
            <input name="q" defaultValue={sp.q || ""} className={`mt-0.5 block w-56 rounded-lg ${fieldClass}`} />
          </label>
          <label className="block">
            <span className="text-xs text-pslate">Status</span>
            <select name="status" defaultValue={sp.status || ""} className={`mt-0.5 block rounded-lg ${fieldClass}`}>
              {STATUSES.map((s) => <option key={s} value={s}>{s ? STATUS_NL[s] || s : "Alle"}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-pslate">Kanaal</span>
            <select name="channel" defaultValue={sp.channel || ""} className={`mt-0.5 block rounded-lg ${fieldClass}`}>
              <option value="">Alle</option>
              <option value="online">Webshop</option>
              <option value="import">Geïmporteerd</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-pslate">Van</span>
            <input type="date" name="from" defaultValue={sp.from || ""} className={`mt-0.5 block rounded-lg ${fieldClass}`} />
          </label>
          <label className="block">
            <span className="text-xs text-pslate">Tot</span>
            <input type="date" name="to" defaultValue={sp.to || ""} className={`mt-0.5 block rounded-lg ${fieldClass}`} />
          </label>
          <button type="submit" className={btnSecondary}>Filter</button>
          {(sp.q || sp.status || sp.channel || sp.from || sp.to) ? <Link href="/account/orders" className="text-sm text-pslate underline">wis</Link> : null}
        </form>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-pnavy-100 bg-pnavy-50/50 text-left text-xs uppercase tracking-wider text-pslate">
                <th className="px-3 py-2.5">Order</th>
                <th className="px-3 py-2.5">Datum</th>
                <th className="px-3 py-2.5">Klant</th>
                <th className="px-3 py-2.5">Plaats</th>
                <th className="px-3 py-2.5">Kanaal</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5 text-right">Bedrag</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((o) => (
                <tr key={o.orderNumber} className="border-b border-pnavy-50 hover:bg-pnavy-50/40">
                  <td className="px-3 py-2 font-medium text-pnavy">{o.orderNumber}</td>
                  <td className="px-3 py-2 text-pslate">{o.createdAt}</td>
                  <td className="px-3 py-2"><span className="block max-w-[14rem] truncate text-pnavy">{o.name || "—"}</span><span className="block max-w-[14rem] truncate text-xs text-pslate">{o.email}</span></td>
                  <td className="px-3 py-2 text-pslate">{o.city}</td>
                  <td className="px-3 py-2 text-xs text-pslate">{o.channel === "import" ? "import" : "webshop"}</td>
                  <td className="px-3 py-2"><StatusBadge status={o.status} /></td>
                  <td className="px-3 py-2 text-right tabular-nums text-pnavy">{euro(o.totalCents)}</td>
                </tr>
              ))}
              {!list.rows.length ? <tr><td colSpan={7} className="py-6 text-center text-pslate">Geen orders gevonden.</td></tr> : null}
            </tbody>
          </table>
        </div>

        {/* Paginatie */}
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-pslate">Pagina {page} / {totalPages.toLocaleString("nl-NL")}</span>
          <div className="flex gap-2">
            {page > 1 ? <Link href={qs({ page: page - 1 })} className={btnSecondary}>← Vorige</Link> : null}
            {page < totalPages ? <Link href={qs({ page: page + 1 })} className={btnSecondary}>Volgende →</Link> : null}
          </div>
        </div>
      </Section>
    </BackofficeShell>
  );
}
