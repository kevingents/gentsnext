"use client";

import { useState } from "react";
import { formatEuro } from "@/lib/pricing";

/* ── Types (plain JSON van de server) ─────────────────────────────────────── */
type Line = { title: string; size: string; color: string; quantity: number; unitPriceCents: number };
type Order = {
  id: string; orderNumber: string; status: string; createdAt: string;
  totalCents: number; lines: Line[];
};
type StoreBuy = {
  id: string; storeName: string; purchasedAt: string; totalCents: number;
  pointsEarned: number; lines: { title: string; size?: string; color?: string; qty?: number; unitPriceCents?: number }[];
};
type Voucher = {
  id: string; code: string; description: string; kind: string; valueCents: number;
  percentOff: number; status: string; expiresAt: string | null;
};
type Loyalty = { id: string; points: number; reason: string; createdAt: string };
type Address = {
  id: string; label: string; street: string; houseNumber: string; postalCode: string;
  city: string; country: string; isDefault: boolean;
};
type Customer = {
  id: string; email: string; firstName: string; lastName: string; phone: string;
  loyaltyPoints: number; sizeProfile: Record<string, string>; marketingOptIn: boolean;
};
type Data = {
  onlineOrders: Order[]; storeBuys: StoreBuy[]; vouchers: Voucher[]; activeVouchers: Voucher[];
  loyalty: Loyalty[]; pointsBalance: number; addresses: Address[];
};

const TABS = [
  { key: "overzicht", label: "Overzicht" },
  { key: "bestellingen", label: "Bestellingen" },
  { key: "punten", label: "Spaarpunten" },
  { key: "vouchers", label: "Vouchers" },
  { key: "maten", label: "Mijn maten" },
  { key: "gegevens", label: "Gegevens" },
  { key: "adressen", label: "Adresboek" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function nlDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const STATUS_NL: Record<string, string> = {
  open: "In afwachting van betaling", paid: "Betaald", shipped: "Verzonden",
  failed: "Mislukt", expired: "Verlopen", canceled: "Geannuleerd", refunded: "Terugbetaald",
};

const NEXT_TIER = 500; // punten voor de volgende beloning

export function ProfileClient({ customer, data }: { customer: Customer; data: Data }) {
  const [tab, setTab] = useState<TabKey>("overzicht");
  const name = customer.firstName || customer.email.split("@")[0];

  return (
    <div className="mx-auto max-w-page px-gutter py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-brand">Mijn GENTS</p>
          <h1 className="mt-2 text-display-md">Hallo {name}</h1>
        </div>
        <form action="/api/account/logout" method="post">
          <button type="submit" className="font-sans text-sm text-muted underline hover:text-ink">Uitloggen</button>
        </form>
      </div>

      {/* Tabs */}
      <nav className="mt-8 flex flex-wrap gap-1 border-b border-line" aria-label="Accountonderdelen">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key}
            className={`-mb-px border-b-2 px-4 py-2.5 font-sans text-sm transition-colors ${
              tab === t.key ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mt-8">
        {tab === "overzicht" && <Overzicht customer={customer} data={data} onTab={setTab} />}
        {tab === "bestellingen" && <Bestellingen data={data} />}
        {tab === "punten" && <Punten data={data} />}
        {tab === "vouchers" && <Vouchers data={data} />}
        {tab === "maten" && <Maten customer={customer} />}
        {tab === "gegevens" && <Gegevens customer={customer} />}
        {tab === "adressen" && <Adressen data={data} />}
      </div>
    </div>
  );
}

/* ── Overzicht ────────────────────────────────────────────────────────────── */
function Overzicht({ customer, data, onTab }: { customer: Customer; data: Data; onTab: (t: TabKey) => void }) {
  const totalOrders = data.onlineOrders.length + data.storeBuys.length;
  const toNext = Math.max(0, NEXT_TIER - data.pointsBalance);
  const pct = Math.min(100, Math.round((data.pointsBalance / NEXT_TIER) * 100));
  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Spaarpunten" value={String(data.pointsBalance)} sub={toNext > 0 ? `Nog ${toNext} tot je volgende beloning` : "Beloning beschikbaar!"} onClick={() => onTab("punten")} />
        <Stat label="Actieve vouchers" value={String(data.activeVouchers.length)} sub="Bekijk je tegoeden" onClick={() => onTab("vouchers")} />
        <Stat label="Aankopen" value={String(totalOrders)} sub="Online + in de winkel" onClick={() => onTab("bestellingen")} />
      </div>

      <div className="border border-line p-5">
        <div className="flex items-center justify-between">
          <p className="font-sans text-sm">Voortgang naar je volgende beloning</p>
          <p className="font-sans text-sm text-muted">{data.pointsBalance} / {NEXT_TIER}</p>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface">
          <div className="h-full bg-ink transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {!customer.sizeProfile?.colbert && !customer.sizeProfile?.overhemd ? (
        <button type="button" onClick={() => onTab("maten")} className="block w-full border border-dashed border-line p-5 text-left hover:border-ink">
          <p className="font-display text-lg font-light">Stel je maatprofiel in</p>
          <p className="mt-1 font-sans text-sm text-ink-soft">Bewaar je colbert-, broek- en overhemdmaat — dan shop je voortaan sneller en krijg je beter advies.</p>
        </button>
      ) : null}

      <RecentActivity data={data} />
    </div>
  );
}

function Stat({ label, value, sub, onClick }: { label: string; value: string; sub: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="border border-line p-5 text-left transition-colors hover:border-ink">
      <p className="label-brand">{label}</p>
      <p className="mt-2 font-display text-3xl font-light">{value}</p>
      <p className="mt-1 font-sans text-xs text-muted">{sub}</p>
    </button>
  );
}

function RecentActivity({ data }: { data: Data }) {
  const items = [
    ...data.onlineOrders.map((o) => ({ when: o.createdAt, kind: "Online", label: `Bestelling ${o.orderNumber}`, total: o.totalCents })),
    ...data.storeBuys.map((s) => ({ when: s.purchasedAt, kind: "Winkel", label: s.storeName || "Winkelaankoop", total: s.totalCents })),
  ]
    .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
    .slice(0, 5);
  if (!items.length) return null;
  return (
    <div>
      <p className="label-brand mb-3">Recente activiteit</p>
      <ul className="divide-y divide-line border-y border-line">
        {items.map((i, idx) => (
          <li key={idx} className="flex items-center justify-between py-3 font-sans text-sm">
            <span className="flex items-center gap-3">
              <span className={`inline-block px-2 py-0.5 text-[0.6rem] uppercase tracking-wide ${i.kind === "Winkel" ? "bg-ink text-canvas" : "border border-line"}`}>{i.kind}</span>
              <span>{i.label}</span>
            </span>
            <span className="text-ink-soft">{nlDate(i.when)} · {formatEuro(i.total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Bestellingen (online + winkel) ───────────────────────────────────────── */
function Bestellingen({ data }: { data: Data }) {
  if (!data.onlineOrders.length && !data.storeBuys.length) {
    return <Empty title="Nog geen aankopen" body="Zodra je online of in de winkel iets koopt, verschijnt het hier — inclusief je winkelaankopen." />;
  }
  return (
    <div className="space-y-8">
      {data.onlineOrders.length ? (
        <section>
          <p className="label-brand mb-3">Online bestellingen</p>
          <ul className="space-y-3">
            {data.onlineOrders.map((o) => (
              <li key={o.id} className="border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">Bestelling {o.orderNumber}</span>
                  <span className="font-sans text-sm text-muted">{nlDate(o.createdAt)}</span>
                </div>
                <p className="mt-1 font-sans text-xs text-ink-soft">{STATUS_NL[o.status] || o.status} · {formatEuro(o.totalCents)}</p>
                {o.lines.length ? (
                  <ul className="mt-3 space-y-1 font-sans text-sm text-ink-soft">
                    {o.lines.map((l, i) => (
                      <li key={i}>{l.quantity}× {l.title}{l.size ? ` — maat ${l.size}` : ""}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.storeBuys.length ? (
        <section>
          <p className="label-brand mb-3">Aankopen in de winkel</p>
          <ul className="space-y-3">
            {data.storeBuys.map((s) => (
              <li key={s.id} className="border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium">
                    <span className="inline-block bg-ink px-2 py-0.5 text-[0.6rem] uppercase tracking-wide text-canvas">Winkel</span>
                    {s.storeName || "Winkelaankoop"}
                  </span>
                  <span className="font-sans text-sm text-muted">{nlDate(s.purchasedAt)}</span>
                </div>
                <p className="mt-1 font-sans text-xs text-ink-soft">{formatEuro(s.totalCents)}{s.pointsEarned ? ` · +${s.pointsEarned} punten` : ""}</p>
                {s.lines?.length ? (
                  <ul className="mt-3 space-y-1 font-sans text-sm text-ink-soft">
                    {s.lines.map((l, i) => (
                      <li key={i}>{l.qty ? `${l.qty}× ` : ""}{l.title}{l.size ? ` — maat ${l.size}` : ""}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/* ── Spaarpunten ──────────────────────────────────────────────────────────── */
function Punten({ data }: { data: Data }) {
  return (
    <div className="space-y-6">
      <div className="border border-line p-6">
        <p className="label-brand">Je saldo</p>
        <p className="mt-2 font-display text-4xl font-light">{data.pointsBalance} <span className="text-lg text-muted">punten</span></p>
        <p className="mt-2 font-sans text-sm text-ink-soft">Je spaart 1 punt per bestede euro — online én in de winkel. Punten verzilver je voor kortingen en exclusieve acties.</p>
      </div>
      {data.loyalty.length ? (
        <ul className="divide-y divide-line border-y border-line">
          {data.loyalty.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-3 font-sans text-sm">
              <span>{e.reason || "Mutatie"} <span className="text-muted">· {nlDate(e.createdAt)}</span></span>
              <span className={e.points >= 0 ? "text-success" : "text-danger"}>{e.points >= 0 ? "+" : ""}{e.points}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="Nog geen punten" body="Je eerste aankoop levert direct spaarpunten op." />
      )}
    </div>
  );
}

/* ── Vouchers ─────────────────────────────────────────────────────────────── */
function Vouchers({ data }: { data: Data }) {
  if (!data.vouchers.length) return <Empty title="Geen vouchers" body="Tegoedbonnen en acties verschijnen hier zodra je ze ontvangt." />;
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {data.vouchers.map((v) => {
        const expired = v.status !== "active" || (v.expiresAt && new Date(v.expiresAt).getTime() < Date.now());
        const value = v.kind === "percent" ? `${v.percentOff}% korting` : formatEuro(v.valueCents);
        return (
          <li key={v.id} className={`border p-5 ${expired ? "border-line opacity-60" : "border-ink"}`}>
            <p className="font-display text-2xl font-light">{value}</p>
            <p className="mt-1 font-sans text-sm text-ink-soft">{v.description || "Tegoedbon"}</p>
            <div className="mt-3 flex items-center justify-between">
              <code className="bg-surface px-2 py-1 font-sans text-sm tracking-wider">{v.code}</code>
              <span className="font-sans text-xs text-muted">
                {expired ? "Verlopen" : v.expiresAt ? `Geldig t/m ${nlDate(v.expiresAt)}` : "Geen einddatum"}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ── Mijn maten ───────────────────────────────────────────────────────────── */
const SIZE_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: "colbert", label: "Colbertmaat", placeholder: "bv. 50" },
  { key: "broek", label: "Broekmaat", placeholder: "bv. 33" },
  { key: "overhemd", label: "Overhemd / boord", placeholder: "bv. 41" },
  { key: "schoen", label: "Schoenmaat", placeholder: "bv. 43" },
  { key: "pasvorm", label: "Pasvoorkeur", placeholder: "modern / slim" },
  { key: "lengte", label: "Lengte (cm)", placeholder: "bv. 184" },
  { key: "gewicht", label: "Gewicht (kg)", placeholder: "bv. 82" },
];

function Maten({ customer }: { customer: Customer }) {
  const [size, setSize] = useState<Record<string, string>>(customer.sizeProfile || {});
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    await fetch("/api/account/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: "size", sizeProfile: size }),
    });
    setState("done");
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <form onSubmit={save} className="max-w-2xl">
      <p className="font-sans text-sm text-ink-soft">
        Bewaar je maten zodat je voortaan sneller de juiste maat kiest. We gebruiken
        ze ook voor persoonlijk maatadvies — nooit voor iets anders.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {SIZE_FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="font-sans text-sm">{f.label}</span>
            <input
              type="text"
              value={size[f.key] || ""}
              placeholder={f.placeholder}
              onChange={(e) => setSize((p) => ({ ...p, [f.key]: e.target.value }))}
              className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
            />
          </label>
        ))}
        <label className="block sm:col-span-2">
          <span className="font-sans text-sm">Notities (bv. voorkeuren, lichaamsbouw)</span>
          <textarea
            rows={3}
            value={size.notities || ""}
            onChange={(e) => setSize((p) => ({ ...p, notities: e.target.value }))}
            className="mt-1 w-full resize-y border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
          />
        </label>
      </div>
      <button type="submit" disabled={state === "busy"} className="btn-primary mt-5">
        {state === "busy" ? "Opslaan…" : state === "done" ? "Opgeslagen ✓" : "Maten opslaan"}
      </button>
    </form>
  );
}

/* ── Gegevens ─────────────────────────────────────────────────────────────── */
function Gegevens({ customer }: { customer: Customer }) {
  const [form, setForm] = useState({
    firstName: customer.firstName, lastName: customer.lastName, phone: customer.phone,
    marketingOptIn: customer.marketingOptIn,
  });
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    await fetch("/api/account/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setState("done");
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <form onSubmit={save} className="max-w-xl space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="font-sans text-sm">Voornaam</span>
          <input type="text" value={form.firstName} onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))} className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
        </label>
        <label className="block">
          <span className="font-sans text-sm">Achternaam</span>
          <input type="text" value={form.lastName} onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))} className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
        </label>
        <label className="block">
          <span className="font-sans text-sm">Telefoon</span>
          <input type="tel" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
        </label>
        <label className="block">
          <span className="font-sans text-sm">E-mailadres</span>
          <input type="email" value={customer.email} disabled className="mt-1 w-full border border-line bg-surface px-3 py-2.5 font-sans text-sm text-muted" />
        </label>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={form.marketingOptIn} onChange={(e) => setForm((p) => ({ ...p, marketingOptIn: e.target.checked }))} />
        <span className="font-sans text-sm">Ja, hou me op de hoogte van nieuwe collecties en acties</span>
      </label>
      <button type="submit" disabled={state === "busy"} className="btn-primary">
        {state === "busy" ? "Opslaan…" : state === "done" ? "Opgeslagen ✓" : "Gegevens opslaan"}
      </button>
    </form>
  );
}

/* ── Adresboek ────────────────────────────────────────────────────────────── */
function Adressen({ data }: { data: Data }) {
  if (!data.addresses.length) {
    return <Empty title="Nog geen adressen" body="Je bezorgadres wordt automatisch bewaard zodra je je eerste online bestelling plaatst." />;
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {data.addresses.map((a) => (
        <li key={a.id} className="border border-line p-5">
          <div className="flex items-center justify-between">
            <p className="font-medium">{a.label}</p>
            {a.isDefault ? <span className="bg-surface px-2 py-0.5 font-sans text-[0.6rem] uppercase tracking-wide">Standaard</span> : null}
          </div>
          <p className="mt-2 font-sans text-sm text-ink-soft">
            {a.street} {a.houseNumber}<br />
            {a.postalCode} {a.city}<br />
            {a.country}
          </p>
        </li>
      ))}
    </ul>
  );
}

/* ── Helper ───────────────────────────────────────────────────────────────── */
function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="border border-dashed border-line p-10 text-center">
      <p className="font-display text-xl font-light">{title}</p>
      <p className="mx-auto mt-2 max-w-md font-sans text-sm text-ink-soft">{body}</p>
    </div>
  );
}
