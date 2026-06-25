"use client";

import { useState } from "react";
import { formatEuro } from "@/lib/pricing";
import { AddressBook } from "@/components/account/address-book";
import { SupportTickets } from "@/components/account/support-tickets";

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
type Giftcard = {
  id: string; code: string; initialCents: number; balanceCents: number;
  status: string; expiresAt: string | null; recipientEmail: string; createdAt: string;
};
type Loyalty = { id: string; points: number; reason: string; createdAt: string };
type Address = {
  id: string; label: string; firstName?: string; lastName?: string; street: string; houseNumber: string; postalCode: string;
  city: string; country: string; isDefault: boolean;
};
type Customer = {
  id: string; email: string; firstName: string; lastName: string; phone: string;
  loyaltyPoints: number; sizeProfile: Record<string, string>; marketingOptIn: boolean;
  isAdmin?: boolean;
};
type ReturnRow = {
  id: string; orderNumber: string; status: string; method: "dhl" | "store"; refundType: "money" | "credit";
  itemsCents: number; shippingCostCents: number; refundedCents: number; creditCode: string;
  dhlTracking: string; dhlLabelUrl: string; createdAt: string;
  lines: { title: string; size: string; color: string; qty: number }[];
};
type Data = {
  onlineOrders: Order[]; storeBuys: StoreBuy[]; vouchers: Voucher[]; activeVouchers: Voucher[];
  giftcards: Giftcard[]; loyalty: Loyalty[]; pointsBalance: number; addresses: Address[];
  returns: ReturnRow[];
};

const TABS = [
  { key: "overzicht", label: "Overzicht" },
  { key: "bestellingen", label: "Bestellingen" },
  { key: "retouren", label: "Retouren" },
  { key: "punten", label: "Spaarpunten" },
  { key: "vouchers", label: "Tegoed" },
  { key: "maten", label: "Mijn maten" },
  { key: "gegevens", label: "Gegevens" },
  { key: "adressen", label: "Adresboek" },
  { key: "vragen", label: "Mijn vragen" },
  { key: "privacy", label: "Privacy" },
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

const RET_STATUS_NL: Record<string, string> = {
  requested: "aangemeld", label_created: "label klaar", received: "ontvangen",
  completed: "afgehandeld", cancelled: "geannuleerd",
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
        <div className="flex items-center gap-4">
          {customer.isAdmin ? (
            <>
              <a href="/account/statistieken" className="font-sans text-sm text-ink underline hover:text-ink">Statistieken</a>
              <a href="/account/orders" className="font-sans text-sm text-ink underline hover:text-ink">Orders</a>
              <a href="/account/klanten" className="font-sans text-sm text-ink underline hover:text-ink">Klanten</a>
              <a href="/account/rapportages" className="font-sans text-sm text-ink underline hover:text-ink">Rapportages</a>
              <a href="/account/reviews" className="font-sans text-sm text-ink underline hover:text-ink">Reviews</a>
              <a href="/account/instellingen" className="font-sans text-sm text-ink underline hover:text-ink">Instellingen</a>
            </>
          ) : null}
          <form action="/api/account/logout" method="post">
            <button type="submit" className="font-sans text-sm text-muted underline hover:text-ink">Uitloggen</button>
          </form>
        </div>
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
        {tab === "retouren" && <Retouren data={data} />}
        {tab === "punten" && <Punten data={data} />}
        {tab === "vouchers" && <Vouchers data={data} />}
        {tab === "maten" && <Maten customer={customer} />}
        {tab === "gegevens" && <Gegevens customer={customer} />}
        {tab === "adressen" && <Adressen data={data} />}
        {tab === "vragen" && <SupportTickets />}
        {tab === "privacy" && <Privacy />}
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

      <div>
        <p className="label-brand mb-3">Ga snel naar</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <QuickTile title="Mijn bestellingen" sub="Bekijk je orders + status" onClick={() => onTab("bestellingen")} />
          <QuickTile title="Retourneren" sub={data.returns.length ? `${data.returns.length} retour(en) · bekijk status` : "Iets terugsturen of ruilen"} onClick={() => onTab("retouren")} />
          <QuickTile title="Mijn tegoed" sub="Vouchers & cadeaubonnen" onClick={() => onTab("vouchers")} />
          <QuickTile title="Mijn maten" sub="Sneller shoppen + beter advies" onClick={() => onTab("maten")} />
          <QuickTile title="Adresboek" sub="Bezorgadressen beheren" onClick={() => onTab("adressen")} />
          <QuickTile title="Mijn vragen" sub="Contact & klantenservice" onClick={() => onTab("vragen")} />
        </div>
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

function QuickTile({ title, sub, onClick }: { title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex items-center justify-between gap-2 border border-line bg-surface/40 p-4 text-left transition-colors hover:border-ink hover:bg-surface">
      <span>
        <span className="block font-display text-base font-light text-ink">{title}</span>
        <span className="mt-0.5 block font-sans text-xs text-ink-soft">{sub}</span>
      </span>
      <span aria-hidden className="text-ink-soft transition-transform group-hover:translate-x-0.5">→</span>
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
                <OrderReturnFooter order={o} returns={data.returns} />
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

function OrderReturnFooter({ order, returns }: { order: Order; returns: ReturnRow[] }) {
  const ret = returns.find((r) => r.orderNumber === order.orderNumber);
  const returnable = ["paid", "shipped", "delivered", "ready_pickup"].includes(order.status);
  if (!ret && !returnable) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 font-sans text-xs">
      {ret ? (
        <span className="text-ink-soft">
          Retour {RET_STATUS_NL[ret.status] || ret.status}
          {ret.refundType === "credit" && ret.creditCode ? ` · tegoed ${ret.creditCode}` : ""}
          {ret.refundType === "money" && ret.refundedCents ? ` · ${formatEuro(ret.refundedCents)} terugbetaald` : ""}
        </span>
      ) : (
        <a href={`/retourneren?order=${encodeURIComponent(order.orderNumber)}`} className="underline underline-offset-2 hover:opacity-70">Retourneren</a>
      )}
    </div>
  );
}

/* ── Retouren ─────────────────────────────────────────────────────────────── */
function Retouren({ data }: { data: Data }) {
  if (!data.returns.length) {
    return (
      <div className="space-y-5">
        <Empty title="Nog geen retouren" body="Iets terugsturen of ruilen? Kies tegoed/omruilen en je retour is gratis. Start hieronder of vanaf je bestelling." />
        <a href="/retourneren" className="btn-primary inline-block">Retour starten</a>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="label-brand">Mijn retouren</p>
        <a href="/retourneren" className="font-sans text-sm underline underline-offset-2 hover:opacity-70">Nieuwe retour</a>
      </div>
      <ul className="space-y-3">
        {data.returns.map((r) => (
          <li key={r.id} className="border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">Retour · bestelling {r.orderNumber}</span>
              <span className="inline-block border border-line px-2 py-0.5 text-[0.6rem] uppercase tracking-wide">{RET_STATUS_NL[r.status] || r.status}</span>
            </div>
            <p className="mt-1 font-sans text-xs text-ink-soft">{r.method === "dhl" ? "Per DHL" : "In de winkel"} · {r.refundType === "credit" ? "tegoed" : "geld terug"} · {nlDate(r.createdAt)}</p>
            {r.lines.length ? (
              <ul className="mt-3 space-y-1 font-sans text-sm text-ink-soft">
                {r.lines.map((l, i) => <li key={i}>{l.qty}× {l.title}{l.size ? ` — maat ${l.size}` : ""}</li>)}
              </ul>
            ) : null}
            {(r.dhlLabelUrl || r.dhlTracking || r.creditCode || (r.status === "completed" && r.refundType === "money")) && (
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 font-sans text-xs text-ink-soft">
                {r.dhlLabelUrl ? <a href={r.dhlLabelUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-70">Retourlabel</a> : null}
                {r.dhlTracking ? <span>Track &amp; trace: {r.dhlTracking}</span> : null}
                {r.creditCode ? <span className="text-ink">Tegoed: {r.creditCode}</span> : null}
                {r.status === "completed" && r.refundType === "money" ? <span>{formatEuro(r.refundedCents)} terugbetaald</span> : null}
              </div>
            )}
          </li>
        ))}
      </ul>
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
  const hasGiftcards = data.giftcards.length > 0;
  const hasVouchers = data.vouchers.length > 0;
  if (!hasGiftcards && !hasVouchers) {
    return <Empty title="Geen tegoed" body="Cadeaubonnen, tegoedbonnen en acties verschijnen hier zodra je ze ontvangt." />;
  }
  return (
    <div className="space-y-8">
      {hasGiftcards ? (
        <div>
          <p className="font-sans text-sm font-medium text-ink">Cadeaubonnen</p>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2">
            {data.giftcards.map((g) => {
              const expired = Boolean(g.expiresAt && new Date(g.expiresAt).getTime() < Date.now());
              const depleted = g.balanceCents <= 0;
              return (
                <li key={g.id} className={`border p-5 ${depleted || expired ? "border-line opacity-60" : "border-ink"}`}>
                  <p className="font-sans text-xs uppercase tracking-wide text-muted">Saldo</p>
                  <p className="font-display text-2xl font-light">{formatEuro(g.balanceCents)}</p>
                  <p className="mt-0.5 font-sans text-xs text-muted">van {formatEuro(g.initialCents)}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <code className="bg-surface px-2 py-1 font-sans text-sm tracking-wider">{g.code}</code>
                    <span className="font-sans text-xs text-muted">
                      {depleted ? "Gebruikt" : expired ? "Verlopen" : g.expiresAt ? `Geldig t/m ${nlDate(g.expiresAt)}` : ""}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {hasVouchers ? (
        <div>
          {hasGiftcards ? <p className="font-sans text-sm font-medium text-ink">Vouchers</p> : null}
          <ul className={`grid gap-4 sm:grid-cols-2 ${hasGiftcards ? "mt-3" : ""}`}>
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
        </div>
      ) : null}
    </div>
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
        Bewaar je maten en we selecteren ze voortaan automatisch op productpagina&apos;s
        en tonen overal een knop <span className="text-ink">&ldquo;Shop in jouw maat&rdquo;</span>.
        We gebruiken ze alleen hiervoor en voor je maatadvies — nooit voor iets anders.
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
        {state === "busy" ? "Opslaan…" : state === "done" ? "Opgeslagen" : "Maten opslaan"}
      </button>
    </form>
  );
}

/* ── Privacy (AVG: inzage & verwijdering) ─────────────────────────────────── */
function Privacy() {
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function remove() {
    setState("busy");
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      });
      if (res.ok) {
        window.location.href = "/?verwijderd=1";
        return;
      }
      setState("error");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="max-w-2xl space-y-10">
      <section>
        <h2 className="font-display text-xl">Mijn gegevens downloaden</h2>
        <p className="mt-2 font-sans text-sm text-ink-soft">
          Een kopie van alles wat we van je bewaren — profiel, bestellingen, adresboek,
          tegoed en spaarpunten — als JSON-bestand.
        </p>
        <a href="/api/account/export-me" className="btn-ghost mt-4 inline-block">Download mijn gegevens</a>
      </section>

      <section className="border border-danger/30 bg-danger/5 p-5">
        <h2 className="font-display text-xl text-ink">Account verwijderen</h2>
        <p className="mt-2 font-sans text-sm text-ink-soft">
          Je persoonsgegevens (naam, e-mail, telefoon, maten, adressen) worden gewist en je wordt
          uitgelogd. Je bestelhistorie bewaren we geanonimiseerd, omdat de wet ons verplicht de
          administratie te bewaren. Dit kan niet ongedaan worden gemaakt.
        </p>
        <label className="mt-4 block">
          <span className="font-sans text-sm">Typ <span className="font-semibold">VERWIJDER</span> om te bevestigen</span>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 block w-full max-w-xs border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={remove}
          disabled={confirm !== "VERWIJDER" || state === "busy"}
          className="btn-primary mt-4 !bg-danger disabled:opacity-50"
        >
          {state === "busy" ? "Bezig…" : "Account definitief verwijderen"}
        </button>
        {state === "error" ? (
          <p className="mt-2 font-sans text-sm text-danger">Verwijderen lukte niet — probeer het later opnieuw.</p>
        ) : null}
      </section>
    </div>
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
  return <AddressBook addresses={data.addresses} />;
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
