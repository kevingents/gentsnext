import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { customers } from "@/db/schema";
import { getSessionCustomer, getProfileData } from "@/lib/account";
import { AdminNav, Kpi, Section, euro } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Klant", robots: { index: false, follow: false } };

const dateFmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" });
const d = (x: Date | string | null) => (x ? dateFmt.format(new Date(x)) : "—");

type Props = { params: Promise<{ id: string }> };

export default async function KlantDetailPage({ params }: Props) {
  const admin = await getSessionCustomer();
  if (!admin) redirect("/account/login");
  if (!admin.isAdmin) {
    return (
      <div className="mx-auto max-w-page px-gutter py-16">
        <h1 className="text-display-md">Geen toegang</h1>
        <Link href="/account" className="mt-6 inline-block font-sans text-sm text-ink underline">← Terug</Link>
      </div>
    );
  }

  const { id } = await params;
  const db = getDb();
  const [c] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!c) notFound();
  const data = await getProfileData(c.id, c.email);

  const onlineSpent = data.onlineOrders.filter((o) => ["paid", "shipped", "ready_pickup", "delivered"].includes(o.status)).reduce((s, o) => s + o.totalCents, 0);
  const storeSpent = data.storeBuys.reduce((s, b) => s + (b.totalCents || 0), 0);
  const name = `${c.firstName} ${c.lastName}`.trim() || c.email.split("@")[0];

  return (
    <div className="mx-auto max-w-page px-gutter py-10">
      <p className="label-brand">Beheer</p>
      <h1 className="mt-2 text-display-md">{name}</h1>
      <div className="mt-6"><AdminNav active="/account/klanten" /></div>

      <Link href="/account/klanten" className="mb-4 inline-block font-sans text-sm text-muted underline">← Alle klanten</Link>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Online besteed" value={euro(onlineSpent)} sub={`${data.onlineOrders.length} orders`} accent />
        <Kpi label="In de winkel" value={euro(storeSpent)} sub={`${data.storeBuys.length} aankopen`} />
        <Kpi label="Spaarpunten" value={data.pointsBalance.toLocaleString("nl-NL")} />
        <Kpi label="Totaal besteed" value={euro(onlineSpent + storeSpent)} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <Section title="Gegevens">
          <dl className="space-y-1.5 font-sans text-sm">
            <Row label="E-mail" value={c.email} />
            <Row label="Telefoon" value={c.phone || "—"} />
            <Row label="SRS-klantnr" value={c.srsCustomerId || "—"} />
            <Row label="Nieuwsbrief" value={c.marketingOptIn ? "Ja" : "Nee"} />
            <Row label="Klant sinds" value={d(c.createdAt)} />
            <Row label="Laatste login" value={d(c.lastLoginAt)} />
          </dl>
          {data.addresses.length ? (
            <div className="mt-3 border-t border-line pt-3">
              <p className="mb-1 font-sans text-xs uppercase tracking-wide text-muted">Adres</p>
              {data.addresses.slice(0, 2).map((a) => (
                <p key={a.id} className="font-sans text-sm text-ink-soft">{a.street} {a.houseNumber}, {a.postalCode} {a.city}</p>
              ))}
            </div>
          ) : null}
        </Section>

        <div className="lg:col-span-2">
          <Section title={`Online orders — ${data.onlineOrders.length}`}>
            {data.onlineOrders.length ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse font-sans text-sm">
                  <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted"><th className="py-1.5 pr-3">Order</th><th className="py-1.5 pr-3">Datum</th><th className="py-1.5 pr-3">Status</th><th className="py-1.5 pl-3 text-right">Bedrag</th></tr></thead>
                  <tbody>
                    {data.onlineOrders.slice(0, 40).map((o) => (
                      <tr key={o.id} className="border-b border-line/60">
                        <td className="py-1.5 pr-3 font-medium">{o.orderNumber}</td>
                        <td className="py-1.5 pr-3 text-muted">{d(o.createdAt)}</td>
                        <td className="py-1.5 pr-3">{o.status}</td>
                        <td className="py-1.5 pl-3 text-right tabular-nums">{euro(o.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="font-sans text-sm text-muted">Nog geen online orders.</p>}
          </Section>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Section title={`Winkelaankopen — ${data.storeBuys.length}`}>
          {data.storeBuys.length ? (
            <ul className="divide-y divide-line">
              {data.storeBuys.slice(0, 25).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2 font-sans text-sm">
                  <span><span className="font-medium">{b.storeName || "Winkel"}</span> <span className="text-muted">· {d(b.purchasedAt)}</span></span>
                  <span className="tabular-nums">{euro(b.totalCents || 0)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="font-sans text-sm text-muted">Geen winkelaankopen gekoppeld.</p>}
        </Section>
        <Section title="Tegoed & punten">
          <dl className="space-y-1.5 font-sans text-sm">
            <Row label="Spaarpunten" value={data.pointsBalance.toLocaleString("nl-NL")} />
            <Row label="Actieve vouchers" value={String(data.activeVouchers.length)} />
            <Row label="Cadeaubonnen" value={String(data.giftcards.length)} />
          </dl>
          {data.loyalty.length ? (
            <div className="mt-3 border-t border-line pt-3">
              <p className="mb-1 font-sans text-xs uppercase tracking-wide text-muted">Recente puntenmutaties</p>
              <ul className="space-y-1 font-sans text-xs text-ink-soft">
                {data.loyalty.slice(0, 6).map((l) => (
                  <li key={l.id} className="flex justify-between gap-3"><span>{l.reason || "mutatie"} · {d(l.createdAt)}</span><span className="tabular-nums">{l.points > 0 ? "+" : ""}{l.points}</span></li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="max-w-[60%] truncate text-right">{value}</dd>
    </div>
  );
}
