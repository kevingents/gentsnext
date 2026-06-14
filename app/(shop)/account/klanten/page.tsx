import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { listCustomers } from "@/lib/reports";
import { BackofficeShell, Section, euro, fieldClass, btnSecondary } from "@/components/account/report-ui";

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
  const exportHref = `/api/account/export?${new URLSearchParams({ type: "customers", ...(sp.q ? { q: sp.q } : {}) }).toString()}`;

  return (
    <BackofficeShell active="/account/klanten" title="Klanten">
      <Section
        title={`Klantoverzicht — ${list.total.toLocaleString("nl-NL")}`}
        right={<a href={exportHref} className={btnSecondary}>Exporteer CSV</a>}
      >
        <form method="get" action="/account/klanten" className="mb-4 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-xs text-pslate">Zoek (naam/e-mail/telefoon/SRS)</span>
            <input name="q" defaultValue={sp.q || ""} className={`mt-0.5 block w-64 rounded-lg ${fieldClass}`} />
          </label>
          <label className="block">
            <span className="text-xs text-pslate">Sorteer</span>
            <select name="sort" defaultValue={sort} className={`mt-0.5 block rounded-lg ${fieldClass}`}>
              <option value="spent">Meeste besteed</option>
              <option value="orders">Meeste orders</option>
              <option value="recent">Nieuwste</option>
            </select>
          </label>
          <button type="submit" className={btnSecondary}>Filter</button>
          {sp.q ? <Link href="/account/klanten" className="text-sm text-pslate underline">wis</Link> : null}
        </form>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-pnavy-100 bg-pnavy-50/50 text-left text-xs uppercase tracking-wider text-pslate">
                <th className="px-3 py-2.5">Klant</th>
                <th className="px-3 py-2.5">Telefoon</th>
                <th className="px-3 py-2.5">SRS</th>
                <th className="px-3 py-2.5 text-right">Orders</th>
                <th className="px-3 py-2.5 text-right">Besteed</th>
                <th className="px-3 py-2.5">Sinds</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((c) => (
                <tr key={c.id} className="border-b border-pnavy-50 hover:bg-pnavy-50/40">
                  <td className="px-3 py-2">
                    <Link href={`/account/klanten/${c.id}`} className="block max-w-[16rem] truncate font-medium text-pnavy hover:underline">{c.name || c.email.split("@")[0]}</Link>
                    <span className="block max-w-[16rem] truncate text-xs text-pslate">{c.email}</span>
                  </td>
                  <td className="px-3 py-2 text-pslate">{c.phone || "—"}</td>
                  <td className="px-3 py-2 text-pslate">{c.srsCustomerId || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-pnavy">{c.orders}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-pnavy">{euro(c.spentCents)}</td>
                  <td className="px-3 py-2 text-pslate">{c.createdAt}</td>
                </tr>
              ))}
              {!list.rows.length ? <tr><td colSpan={6} className="py-6 text-center text-pslate">Geen klanten gevonden.</td></tr> : null}
            </tbody>
          </table>
        </div>

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
