import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { listCustomers } from "@/lib/reports";
import { AdminNav, Section, euro } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Klanten", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ q?: string; sort?: string; page?: string }> };

export default async function KlantenPage({ searchParams }: Props) {
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
  const sort = (sp.sort as "spent" | "orders" | "recent") || "spent";
  const list = await listCustomers({ search: sp.q, sort, page, pageSize: 50 });
  const totalPages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const qs = (p: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, sort: sp.sort, ...p })) if (v) u.set(k, String(v));
    return `?${u.toString()}`;
  };

  return (
    <div className="mx-auto max-w-page px-gutter py-10">
      <p className="label-brand">Beheer</p>
      <h1 className="mt-2 text-display-md">Klanten</h1>
      <div className="mt-6"><AdminNav active="/account/klanten" /></div>

      <Section title={`Klantoverzicht — ${list.total.toLocaleString("nl-NL")}`}>
        <form method="get" action="/account/klanten" className="mb-4 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="font-sans text-xs text-muted">Zoek (naam/e-mail/telefoon/SRS)</span>
            <input name="q" defaultValue={sp.q || ""} className="mt-0.5 block w-64 border border-line bg-canvas px-2 py-1.5 font-sans text-sm focus:border-ink focus:outline-none" />
          </label>
          <label className="block">
            <span className="font-sans text-xs text-muted">Sorteer</span>
            <select name="sort" defaultValue={sort} className="mt-0.5 block border border-line bg-canvas px-2 py-1.5 font-sans text-sm focus:border-ink focus:outline-none">
              <option value="spent">Meeste besteed</option>
              <option value="orders">Meeste orders</option>
              <option value="recent">Nieuwste</option>
            </select>
          </label>
          <button type="submit" className="btn-ghost !px-4 !py-1.5 text-sm">Filter</button>
          {sp.q ? <Link href="/account/klanten" className="font-sans text-sm text-muted underline">wis</Link> : null}
        </form>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-sans text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3">Klant</th>
                <th className="py-2 pr-3">Telefoon</th>
                <th className="py-2 pr-3">SRS</th>
                <th className="py-2 pr-3 text-right">Orders</th>
                <th className="py-2 pr-3 text-right">Besteed</th>
                <th className="py-2 pl-3">Sinds</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((c) => (
                <tr key={c.id} className="border-b border-line/60">
                  <td className="py-2 pr-3">
                    <Link href={`/account/klanten/${c.id}`} className="block max-w-[16rem] truncate font-medium hover:underline">{c.name || c.email.split("@")[0]}</Link>
                    <span className="block max-w-[16rem] truncate text-xs text-muted">{c.email}</span>
                  </td>
                  <td className="py-2 pr-3 text-muted">{c.phone || "—"}</td>
                  <td className="py-2 pr-3 text-muted">{c.srsCustomerId || "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{c.orders}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{euro(c.spentCents)}</td>
                  <td className="py-2 pl-3 text-muted">{c.createdAt}</td>
                </tr>
              ))}
              {!list.rows.length ? <tr><td colSpan={6} className="py-6 text-center text-muted">Geen klanten gevonden.</td></tr> : null}
            </tbody>
          </table>
        </div>

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
