import Link from "next/link";
import { formatEuro } from "@/lib/pricing";

/** Back-office navigatie tussen de beheerpagina's. */
const NAV = [
  { href: "/account/statistieken", label: "Statistieken" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/klanten", label: "Klanten" },
  { href: "/account/rapportages", label: "Rapportages" },
  { href: "/account/reviews", label: "Reviews" },
  { href: "/account/analytics", label: "Funnel" },
  { href: "/account/instellingen", label: "Instellingen" },
];

export function AdminNav({ active }: { active: string }) {
  return (
    <nav className="mb-8 flex flex-wrap gap-x-1 gap-y-1 border-b border-line" aria-label="Beheer">
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={`-mb-px border-b-2 px-3 py-2 font-sans text-sm transition-colors ${
            active === n.href ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

export function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-card border p-4 ${accent ? "border-ink" : "border-line"}`}>
      <p className="font-sans text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl">{value}</p>
      {sub ? <p className="mt-0.5 font-sans text-xs text-muted">{sub}</p> : null}
    </div>
  );
}

export function euro(c: number): string {
  return formatEuro(c);
}

/** Horizontale balklijst (categorie, top-producten, statusverdeling…). */
export function BarList({
  items,
  money,
}: {
  items: { label: string; value: number; sub?: string; href?: string }[];
  money?: boolean;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="font-sans text-sm text-muted">Geen data in deze periode.</p>;
  return (
    <ul className="space-y-2">
      {items.map((i, idx) => (
        <li key={i.label + idx}>
          <div className="flex items-baseline justify-between gap-3 font-sans text-sm">
            <span className="min-w-0 truncate">
              {i.href ? (
                <Link href={i.href} className="hover:underline">{i.label}</Link>
              ) : (
                i.label
              )}
            </span>
            <span className="shrink-0 tabular-nums">{money ? formatEuro(i.value) : i.value.toLocaleString("nl-NL")}{i.sub ? <span className="ml-2 text-muted">{i.sub}</span> : null}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface">
            <div className="h-full bg-ink" style={{ width: `${Math.round((i.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Verticale dagbalken (omzet per dag). */
export function DayBars({ data }: { data: { day: string; revenueCents: number; orders: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.revenueCents));
  if (!data.length) return <p className="font-sans text-sm text-muted">Geen omzet in deze periode.</p>;
  return (
    <div>
      <div className="flex h-40 items-end gap-0.5">
        {data.map((d) => (
          <div
            key={d.day}
            title={`${d.day} · ${formatEuro(d.revenueCents)} · ${d.orders} orders`}
            className="flex-1 rounded-t bg-ink/80 transition-colors hover:bg-ink"
            style={{ height: `${Math.max(2, Math.round((d.revenueCents / max) * 100))}%` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-sans text-[0.65rem] text-muted">
        <span>{data[0]?.day}</span>
        <span>{data[data.length - 1]?.day}</span>
      </div>
    </div>
  );
}

/** Datumbereik-filter (GET-form, geen client-JS). */
export function RangeForm({ from, to, action }: { from: Date; to: Date; action: string }) {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-2">
      <label className="block">
        <span className="font-sans text-xs text-muted">Van</span>
        <input type="date" name="from" defaultValue={fmt(from)} className="mt-0.5 block border border-line bg-canvas px-2 py-1.5 font-sans text-sm focus:border-ink focus:outline-none" />
      </label>
      <label className="block">
        <span className="font-sans text-xs text-muted">Tot</span>
        <input type="date" name="to" defaultValue={fmt(to)} className="mt-0.5 block border border-line bg-canvas px-2 py-1.5 font-sans text-sm focus:border-ink focus:outline-none" />
      </label>
      <button type="submit" className="btn-ghost !px-4 !py-1.5 text-sm">Toon</button>
    </form>
  );
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="label-brand">{title}</p>
        {right}
      </div>
      {children}
    </section>
  );
}
