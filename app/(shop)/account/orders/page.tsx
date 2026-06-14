import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { listOperationalOrders } from "@/lib/orders";
import { listOrders } from "@/lib/reports";
import { OrdersAdmin } from "@/components/account/orders-admin";
import { AdminNav, Section, euro } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Orders", robots: { index: false, follow: false } };

const STATUSES = ["", "paid", "open", "shipped", "ready_pickup", "delivered", "refunded", "canceled", "failed", "expired"];
const STATUS_NL: Record<string, string> = {
  open: "Open", paid: "Betaald", shipped: "Verzonden", ready_pickup: "Klaar om af te halen",
  delivered: "Bezorgd", refunded: "Terugbetaald", canceled: "Geannuleerd", failed: "Mislukt", expired: "Verlopen",
};

type Props = { searchParams: Promise<{ q?: string; status?: string; channel?: string; from?: string; to?: string; page?: string }> };

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
  }));

  const totalPages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const qs = (p: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, status: sp.status, channel: sp.channel, from: sp.from, to: sp.to, ...p })) {
      if (v) u.set(k, String(v));
    }
    return `?${u.toString()}`;
  };

  return (
    <div className="mx-auto max-w-page px-gutter py-10">
      <p className="label-brand">Beheer</p>
      <h1 className="mt-2 text-display-md">Orders</h1>
      <div className="mt-6"><AdminNav active="/account/orders" /></div>

      {operational.length ? (
        <div className="mb-8">
          <Section title={`Te verwerken — ${operational.length} operationele orders`}>
            <p className="mb-3 font-sans text-xs text-muted">Nieuwe webshop-orders (geen geïmporteerde historie). Een statuswijziging stuurt de klant een update.</p>
            <OrdersAdmin orders={operational} />
          </Section>
        </div>
      ) : null}

      <Section title={`Alle orders — ${list.total.toLocaleString("nl-NL")}`}>
        {/* Filter (GET) */}
        <form method="get" action="/account/orders" className="mb-4 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="font-sans text-xs text-muted">Zoek (nr/e-mail/naam/postcode)</span>
            <input name="q" defaultValue={sp.q || ""} className="mt-0.5 block w-56 border border-line bg-canvas px-2 py-1.5 font-sans text-sm focus:border-ink focus:outline-none" />
          </label>
          <label className="block">
            <span className="font-sans text-xs text-muted">Status</span>
            <select name="status" defaultValue={sp.status || ""} className="mt-0.5 block border border-line bg-canvas px-2 py-1.5 font-sans text-sm focus:border-ink focus:outline-none">
              {STATUSES.map((s) => <option key={s} value={s}>{s ? STATUS_NL[s] || s : "Alle"}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="font-sans text-xs text-muted">Kanaal</span>
            <select name="channel" defaultValue={sp.channel || ""} className="mt-0.5 block border border-line bg-canvas px-2 py-1.5 font-sans text-sm focus:border-ink focus:outline-none">
              <option value="">Alle</option>
              <option value="online">Webshop</option>
              <option value="import">Geïmporteerd</option>
            </select>
          </label>
          <label className="block">
            <span className="font-sans text-xs text-muted">Van</span>
            <input type="date" name="from" defaultValue={sp.from || ""} className="mt-0.5 block border border-line bg-canvas px-2 py-1.5 font-sans text-sm focus:border-ink focus:outline-none" />
          </label>
          <label className="block">
            <span className="font-sans text-xs text-muted">Tot</span>
            <input type="date" name="to" defaultValue={sp.to || ""} className="mt-0.5 block border border-line bg-canvas px-2 py-1.5 font-sans text-sm focus:border-ink focus:outline-none" />
          </label>
          <button type="submit" className="btn-ghost !px-4 !py-1.5 text-sm">Filter</button>
          {(sp.q || sp.status || sp.channel || sp.from || sp.to) ? <Link href="/account/orders" className="font-sans text-sm text-muted underline">wis</Link> : null}
        </form>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-sans text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3">Order</th>
                <th className="py-2 pr-3">Datum</th>
                <th className="py-2 pr-3">Klant</th>
                <th className="py-2 pr-3">Plaats</th>
                <th className="py-2 pr-3">Kanaal</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pl-3 text-right">Bedrag</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((o) => (
                <tr key={o.orderNumber} className="border-b border-line/60">
                  <td className="py-2 pr-3 font-medium">{o.orderNumber}</td>
                  <td className="py-2 pr-3 text-muted">{o.createdAt}</td>
                  <td className="py-2 pr-3"><span className="block max-w-[14rem] truncate">{o.name || "—"}</span><span className="block max-w-[14rem] truncate text-xs text-muted">{o.email}</span></td>
                  <td className="py-2 pr-3 text-muted">{o.city}</td>
                  <td className="py-2 pr-3"><span className="text-xs text-muted">{o.channel === "import" ? "import" : "webshop"}</span></td>
                  <td className="py-2 pr-3">{STATUS_NL[o.status] || o.status}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{euro(o.totalCents)}</td>
                </tr>
              ))}
              {!list.rows.length ? <tr><td colSpan={7} className="py-6 text-center text-muted">Geen orders gevonden.</td></tr> : null}
            </tbody>
          </table>
        </div>

        {/* Paginatie */}
        <div className="mt-4 flex items-center justify-between font-sans text-sm">
          <span className="text-muted">Pagina {page} / {totalPages.toLocaleString("nl-NL")}</span>
          <div className="flex gap-2">
            {page > 1 ? <Link href={qs({ page: page - 1 })} className="btn-ghost !px-3 !py-1.5">← Vorige</Link> : null}
            {page < totalPages ? <Link href={qs({ page: page + 1 })} className="btn-ghost !px-3 !py-1.5">Volgende →</Link> : null}
          </div>
        </div>
      </Section>
    </div>
  );
}
