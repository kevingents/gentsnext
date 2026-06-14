import Link from "next/link";
import { formatEuro } from "@/lib/pricing";

/** Back-office in de portal-huisstijl: navy sidebar + cream content + witte cards. */

const ICONS: Record<string, string> = {
  chart: "M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-8",
  cart: "M6 6h15l-1.5 9h-12L5 3H2M9 20a1 1 0 100 2 1 1 0 000-2m8 0a1 1 0 100 2 1 1 0 000-2",
  users: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8m13 10v-2a4 4 0 00-3-3.87M16 3.13A4 4 0 0116 11",
  doc: "M14 3v5h5M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V8l-6-5M8 13h8M8 17h6",
  star: "M12 2l3 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.9 21l1.2-6.8-5-4.9 6.9-1L12 2z",
  funnel: "M3 4h18l-7 8v7l-4 2v-9L3 4z",
  gear: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 005.1 19l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H1a2 2 0 110-4h.1A1.7 1.7 0 003 5.1l-.1-.1A2 2 0 115.7 2.2l.1.1A1.7 1.7 0 009 1.5V1a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9",
  image: "M3 5h18v14H3V5zm0 11l5-5 4 4 3-3 6 6M16 9a1 1 0 100-2 1 1 0 000 2z",
};

const NAV = [
  { href: "/account/statistieken", label: "Statistieken", icon: "chart" },
  { href: "/account/orders", label: "Orders", icon: "cart" },
  { href: "/account/klanten", label: "Klanten", icon: "users" },
  { href: "/account/rapportages", label: "Rapportages", icon: "doc" },
  { href: "/account/reviews", label: "Reviews", icon: "star" },
  { href: "/account/analytics", label: "Funnel", icon: "funnel" },
  { href: "/account/productmedia", label: "Productmedia", icon: "image" },
  { href: "/account/instellingen", label: "Instellingen", icon: "gear" },
];

function NavIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name] || ""} />
    </svg>
  );
}

export function BackofficeShell({ active, title, children }: { active: string; title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-pcream font-sans text-pnavy">
      <div className="mx-auto flex max-w-[100rem] gap-6 px-4 py-6">
        {/* Desktop sidebar */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-6 rounded-xl bg-pnavy p-3 shadow-portal">
            <div className="mb-3 flex items-center gap-2.5 px-2 py-2">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-cream/10 font-display text-sm tracking-brand text-cream">G</span>
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-wide text-cream">GENTS</div>
                <div className="text-[10px] uppercase tracking-wider text-cream/50">Back-office</div>
              </div>
            </div>
            <nav className="space-y-0.5">
              {NAV.map((n) => {
                const on = active === n.href;
                return (
                  <Link key={n.href} href={n.href} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${on ? "bg-cream/15 font-medium text-cream" : "text-cream/70 hover:bg-cream/10 hover:text-cream"}`}>
                    <NavIcon name={n.icon} />
                    {n.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-3 border-t border-cream/10 pt-2">
              <Link href="/" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-cream/55 hover:text-cream">← Naar de site</Link>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <h1 className="mb-1 text-2xl font-semibold text-pnavy">{title}</h1>
          {/* Mobiele nav */}
          <nav className="mb-5 flex gap-1 overflow-x-auto lg:hidden">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${active === n.href ? "bg-pnavy text-cream" : "bg-white text-pslate hover:text-pnavy"}`}>{n.label}</Link>
            ))}
          </nav>
          <div className="mt-4 space-y-5">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function euro(c: number): string {
  return formatEuro(c);
}

export function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-5 shadow-portal ${accent ? "border-pnavy-600/40 ring-2 ring-pnavy/10" : "border-pnavy-100"}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-pslate">{label}</p>
      <p className="mt-2.5 text-3xl font-semibold tabular-nums text-pnavy">{value}</p>
      {sub ? <p className="mt-1 text-sm text-pslate">{sub}</p> : null}
    </div>
  );
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-pnavy-100 bg-white p-5 shadow-portal">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-pslate">{title}</p>
        {right}
      </div>
      {children}
    </section>
  );
}

export function BarList({ items, money }: { items: { label: string; value: number; sub?: string; href?: string }[]; money?: boolean }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="text-sm text-pslate">Geen data in deze periode.</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((i, idx) => (
        <li key={i.label + idx}>
          <div className="flex items-baseline justify-between gap-3 text-sm text-pnavy">
            <span className="min-w-0 truncate">{i.href ? <Link href={i.href} className="hover:underline">{i.label}</Link> : i.label}</span>
            <span className="shrink-0 tabular-nums">{money ? formatEuro(i.value) : i.value.toLocaleString("nl-NL")}{i.sub ? <span className="ml-2 text-pslate">{i.sub}</span> : null}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-pnavy-50">
            <div className="h-full rounded-full bg-pnavy" style={{ width: `${Math.round((i.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DayBars({ data }: { data: { day: string; revenueCents: number; orders: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.revenueCents));
  if (!data.length) return <p className="text-sm text-pslate">Geen omzet in deze periode.</p>;
  return (
    <div>
      <div className="flex h-40 items-end gap-0.5">
        {data.map((d) => (
          <div key={d.day} title={`${d.day} · ${formatEuro(d.revenueCents)} · ${d.orders} orders`} className="flex-1 rounded-t bg-pnavy-600 transition-colors hover:bg-pnavy" style={{ height: `${Math.max(2, Math.round((d.revenueCents / max) * 100))}%` }} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[0.65rem] text-pslate">
        <span>{data[0]?.day}</span>
        <span>{data[data.length - 1]?.day}</span>
      </div>
    </div>
  );
}

const FIELD = "border border-pnavy-100 bg-white px-2.5 py-1.5 text-sm text-pnavy focus:border-pnavy-600 focus:outline-none";
export const fieldClass = FIELD;
export const btnPrimary = "inline-flex items-center justify-center rounded-lg bg-pnavy px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-pnavy-700";
export const btnSecondary = "inline-flex items-center justify-center rounded-lg border border-pnavy-100 bg-white px-4 py-2 text-sm font-medium text-pnavy transition-colors hover:bg-pnavy-50";

export function RangeForm({ from, to, action }: { from: Date; to: Date; action: string }) {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-2">
      <label className="block">
        <span className="text-xs text-pslate">Van</span>
        <input type="date" name="from" defaultValue={fmt(from)} className={`mt-0.5 block rounded-lg ${FIELD}`} />
      </label>
      <label className="block">
        <span className="text-xs text-pslate">Tot</span>
        <input type="date" name="to" defaultValue={fmt(to)} className={`mt-0.5 block rounded-lg ${FIELD}`} />
      </label>
      <button type="submit" className={btnSecondary}>Toon</button>
    </form>
  );
}

/** Statusgekleurde badge (portal-tonen). */
export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "paid" || status === "delivered" || status === "shipped" || status === "ready_pickup" ? "bg-emerald-50 text-emerald-700"
      : status === "refunded" || status === "failed" || status === "canceled" || status === "expired" ? "bg-red-50 text-red-700"
      : status === "imported" ? "bg-sky-50 text-sky-700"
      : "bg-pnavy-50 text-pslate";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{status}</span>;
}
