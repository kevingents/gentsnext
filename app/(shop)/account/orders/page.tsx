import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { listRecentOrders } from "@/lib/orders";
import { OrdersAdmin } from "@/components/account/orders-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Orders", robots: { index: false, follow: false } };

export default async function OrdersPage() {
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
  const rows = await listRecentOrders(60);
  const orders = rows.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    email: o.email,
    name: `${o.firstName} ${o.lastName}`.trim(),
    city: o.city,
    totalCents: o.totalCents,
    deliveryMethod: o.deliveryMethod,
    fulfillmentStatus: o.fulfillmentStatus,
    createdAt: o.createdAt.toISOString(),
  }));

  return (
    <div className="mx-auto max-w-page px-gutter py-10">
      <p className="label-brand">Beheer</p>
      <h1 className="mt-2 text-display-md">Orders</h1>
      <p className="mt-2 font-sans text-sm text-muted">Laatste {orders.length} bestellingen. Statuswijziging stuurt de klant een update (mail + WhatsApp).</p>
      <OrdersAdmin orders={orders} />
    </div>
  );
}
