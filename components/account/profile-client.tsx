"use client";

import { useState } from "react";
import { CheckIcon } from "@/components/icons";
import { useT } from "@/components/i18n/locale-provider";
import { ORDER_STATUS_NL_KLANT, RETURN_STATUS_NL } from "@/lib/order-status";
import { formatEuro } from "@/lib/pricing";
import { AddressBook } from "@/components/account/address-book";
import { SupportTickets } from "@/components/account/support-tickets";
import { ProductCard } from "@/components/product-card";
import { AppleWalletButton } from "@/components/account/apple-wallet-button";
import type { ProductCardData } from "@/lib/catalog";

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
  giftcards: Giftcard[]; loyalty: Loyalty[]; pointsBalance: number; pointsAvailable: number; pointsPending: number; addresses: Address[];
  returns: ReturnRow[]; returnWindowDays: number; newInSize: ProductCardData[]; recommended: ProductCardData[];
};

// label = i18n-key; vertaald bij render via useT.
const TABS = [
  { key: "overzicht", label: "account.tabs.overview" },
  { key: "bestellingen", label: "account.tabs.orders" },
  { key: "retouren", label: "account.tabs.returns" },
  { key: "punten", label: "account.tabs.points" },
  { key: "vouchers", label: "account.tabs.credit" },
  { key: "maten", label: "account.tabs.sizes" },
  { key: "gegevens", label: "account.tabs.details" },
  { key: "adressen", label: "account.tabs.addresses" },
  { key: "vragen", label: "account.tabs.questions" },
  { key: "privacy", label: "account.tabs.privacy" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function nlDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// Gedeelde status-labels (lib/order-status) — klant-varianten.
const STATUS_NL = ORDER_STATUS_NL_KLANT;
const RET_STATUS_NL = RETURN_STATUS_NL;

const NEXT_TIER = 500; // punten voor de volgende beloning

export function ProfileClient({ customer, data, walletEnabled = false }: { customer: Customer; data: Data; walletEnabled?: boolean }) {
  const t = useT();
  const [tab, setTab] = useState<TabKey>("overzicht");
  const name = customer.firstName || customer.email.split("@")[0];

  return (
    <div className="mx-auto max-w-page px-gutter py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-brand">{t("login.eyebrow")}</p>
          <h1 className="mt-2 text-display-md">{t("account.hello", { name })}</h1>
        </div>
        <div className="flex items-center gap-4">
          {customer.isAdmin ? (
            <>
              <a href="/account/statistieken" className="font-sans text-sm text-ink underline hover:text-ink">{t("account.admin.statistics")}</a>
              <a href="/account/orders" className="font-sans text-sm text-ink underline hover:text-ink">{t("account.admin.orders")}</a>
              <a href="/account/klanten" className="font-sans text-sm text-ink underline hover:text-ink">{t("account.admin.customers")}</a>
              <a href="/account/rapportages" className="font-sans text-sm text-ink underline hover:text-ink">{t("account.admin.reports")}</a>
              <a href="/account/reviews" className="font-sans text-sm text-ink underline hover:text-ink">{t("account.admin.reviews")}</a>
              <a href="/account/instellingen" className="font-sans text-sm text-ink underline hover:text-ink">{t("account.admin.settings")}</a>
            </>
          ) : null}
          <form action="/api/account/logout" method="post">
            <button type="submit" className="font-sans text-sm text-muted underline hover:text-ink">{t("account.logout")}</button>
          </form>
        </div>
      </div>

      {/* Tabs */}
      <nav className="mt-8 flex flex-wrap gap-1 border-b border-line" aria-label={t("account.tabs.ariaLabel")}>
        {TABS.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            aria-current={tab === tb.key}
            className={`-mb-px border-b-2 px-4 py-2.5 font-sans text-sm transition-colors ${
              tab === tb.key ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t(tb.label)}
          </button>
        ))}
      </nav>

      <div className="mt-8">
        {tab === "overzicht" && <Overzicht customer={customer} data={data} onTab={setTab} />}
        {tab === "bestellingen" && <Bestellingen data={data} />}
        {tab === "retouren" && <Retouren data={data} />}
        {tab === "punten" && <Punten data={data} walletEnabled={walletEnabled} />}
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
  const t = useT();
  const totalOrders = data.onlineOrders.length + data.storeBuys.length;
  const toNext = Math.max(0, NEXT_TIER - data.pointsBalance);
  const pct = Math.min(100, Math.round((data.pointsBalance / NEXT_TIER) * 100));
  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={t("account.tabs.points")} value={String(data.pointsAvailable)} sub={data.pointsPending > 0 ? t("account.overview.pointsPending", { n: data.pointsPending }) : toNext > 0 ? t("account.overview.pointsToNext", { n: toNext }) : t("account.overview.rewardAvailable")} onClick={() => onTab("punten")} />
        <Stat label={t("account.overview.activeVouchers")} value={String(data.activeVouchers.length)} sub={t("account.overview.viewCredit")} onClick={() => onTab("vouchers")} />
        <Stat label={t("account.overview.purchases")} value={String(totalOrders)} sub={t("account.overview.onlinePlusStore")} onClick={() => onTab("bestellingen")} />
      </div>

      <div>
        <p className="label-brand mb-3">{t("account.overview.quickNav")}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <QuickTile title={t("account.quick.orders.title")} sub={t("account.quick.orders.sub")} onClick={() => onTab("bestellingen")} />
          <QuickTile title={t("retourneren.title")} sub={data.returns.length ? t("account.quick.returns.count", { n: data.returns.length }) : t("account.quick.returns.sub")} onClick={() => onTab("retouren")} />
          <QuickTile title={t("account.quick.credit.title")} sub={t("account.quick.credit.sub")} onClick={() => onTab("vouchers")} />
          <QuickTile title={t("account.tabs.sizes")} sub={t("account.quick.sizes.sub")} onClick={() => onTab("maten")} />
          <QuickTile title={t("account.tabs.addresses")} sub={t("account.quick.addresses.sub")} onClick={() => onTab("adressen")} />
          <QuickTile title={t("account.tabs.questions")} sub={t("account.quick.questions.sub")} onClick={() => onTab("vragen")} />
        </div>
      </div>

      {data.newInSize.length ? (
        <div>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <p className="label-brand">{t("account.overview.newInSize")}</p>
            <a href="/collections/nieuwe-collectie-gents" className="font-sans text-xs text-ink-soft underline underline-offset-2 hover:text-ink">{t("account.overview.allNewArrivals")}</a>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4">
            {data.newInSize.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </div>
      ) : null}

      {data.recommended.length ? (
        <div>
          <p className="label-brand mb-1">{t("account.overview.recommendedTitle")}</p>
          <p className="mb-3 font-sans text-xs text-ink-soft">{t("account.overview.recommendedSub")}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4">
            {data.recommended.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </div>
      ) : null}

      <div className="border border-line p-5">
        <div className="flex items-center justify-between">
          <p className="font-sans text-sm">{t("account.overview.progressTitle")}</p>
          <p className="font-sans text-sm text-muted">{data.pointsBalance} / {NEXT_TIER}</p>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface">
          <div className="h-full bg-ink transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {!customer.sizeProfile?.colbert && !customer.sizeProfile?.overhemd ? (
        <button type="button" onClick={() => onTab("maten")} className="block w-full border border-dashed border-line p-5 text-left hover:border-ink">
          <p className="font-display text-lg font-light">{t("account.overview.sizeCtaTitle")}</p>
          <p className="mt-1 font-sans text-sm text-ink-soft">{t("account.overview.sizeCtaBody")}</p>
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
  const t = useT();
  const items = [
    ...data.onlineOrders.map((o) => ({ when: o.createdAt, kind: "Online", label: t("account.orderNumber", { n: o.orderNumber }), total: o.totalCents })),
    ...data.storeBuys.map((s) => ({ when: s.purchasedAt, kind: "Winkel", label: s.storeName || t("account.activity.storePurchase"), total: s.totalCents })),
  ]
    .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
    .slice(0, 5);
  if (!items.length) return null;
  return (
    <div>
      <p className="label-brand mb-3">{t("account.activity.title")}</p>
      <ul className="divide-y divide-line border-y border-line">
        {items.map((i, idx) => (
          <li key={idx} className="flex items-center justify-between py-3 font-sans text-sm">
            <span className="flex items-center gap-3">
              <span className={`inline-block px-2 py-0.5 text-[0.6rem] uppercase tracking-wide ${i.kind === "Winkel" ? "bg-ink text-canvas" : "border border-line"}`}>{i.kind === "Winkel" ? t("account.activity.store") : t("account.activity.online")}</span>
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
  const t = useT();
  if (!data.onlineOrders.length && !data.storeBuys.length) {
    return <Empty title={t("account.orders.emptyTitle")} body={t("account.orders.emptyBody")} />;
  }
  return (
    <div className="space-y-8">
      {data.onlineOrders.length ? (
        <section>
          <p className="label-brand mb-3">{t("account.orders.onlineTitle")}</p>
          <ul className="space-y-3">
            {data.onlineOrders.map((o) => (
              <li key={o.id} className="border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{t("account.orderNumber", { n: o.orderNumber })}</span>
                  <span className="font-sans text-sm text-muted">{nlDate(o.createdAt)}</span>
                </div>
                <p className="mt-1 font-sans text-xs text-ink-soft">{STATUS_NL[o.status] || o.status} · {formatEuro(o.totalCents)}</p>
                {o.lines.length ? (
                  <ul className="mt-3 space-y-1 font-sans text-sm text-ink-soft">
                    {o.lines.map((l, i) => (
                      <li key={i}>{l.quantity}× {l.title}{l.size ? ` — ${t("cart.added.sizeMeta", { size: l.size })}` : ""}</li>
                    ))}
                  </ul>
                ) : null}
                <OrderReturnFooter order={o} returns={data.returns} windowDays={data.returnWindowDays} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.storeBuys.length ? (
        <section>
          <p className="label-brand mb-3">{t("account.orders.storeTitle")}</p>
          <ul className="space-y-3">
            {data.storeBuys.map((s) => (
              <li key={s.id} className="border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium">
                    <span className="inline-block bg-ink px-2 py-0.5 text-[0.6rem] uppercase tracking-wide text-canvas">{t("account.activity.store")}</span>
                    {s.storeName || t("account.activity.storePurchase")}
                  </span>
                  <span className="font-sans text-sm text-muted">{nlDate(s.purchasedAt)}</span>
                </div>
                <p className="mt-1 font-sans text-xs text-ink-soft">{formatEuro(s.totalCents)}{s.pointsEarned ? ` · ${t("puntenClaim.success.points", { points: s.pointsEarned })}` : ""}</p>
                {s.lines?.length ? (
                  <ul className="mt-3 space-y-1 font-sans text-sm text-ink-soft">
                    {s.lines.map((l, i) => (
                      <li key={i}>{l.qty ? `${l.qty}× ` : ""}{l.title}{l.size ? ` — ${t("cart.added.sizeMeta", { size: l.size })}` : ""}</li>
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

function OrderReturnFooter({ order, returns, windowDays }: { order: Order; returns: ReturnRow[]; windowDays: number }) {
  const t = useT();
  const ret = returns.find((r) => r.orderNumber === order.orderNumber);
  const eligible = ["paid", "shipped", "delivered", "ready_pickup"].includes(order.status);
  const withinWindow = Date.now() - new Date(order.createdAt).getTime() <= windowDays * 86400000;
  if (!ret && (!eligible || !withinWindow)) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 font-sans text-xs">
      {ret ? (
        <span className="text-ink-soft">
          {t("account.returns.prefix")} {RET_STATUS_NL[ret.status] || ret.status}
          {ret.refundType === "credit" && ret.creditCode ? ` · ${t("account.returns.creditCode", { code: ret.creditCode })}` : ""}
          {ret.refundType === "money" && ret.refundedCents ? ` · ${t("account.returns.refunded", { amount: formatEuro(ret.refundedCents) })}` : ""}
        </span>
      ) : (
        <a href={`/retourneren?order=${encodeURIComponent(order.orderNumber)}`} className="underline underline-offset-2 hover:opacity-70">{t("retourneren.title")}</a>
      )}
    </div>
  );
}

/* ── Retouren ─────────────────────────────────────────────────────────────── */
function Retouren({ data }: { data: Data }) {
  const t = useT();
  if (!data.returns.length) {
    return (
      <div className="space-y-5">
        <Empty title={t("account.returns.emptyTitle")} body={t("account.returns.emptyBody")} />
        <a href="/retourneren" className="btn-primary inline-block">{t("account.returns.start")}</a>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="label-brand">{t("account.returns.title")}</p>
        <a href="/retourneren" className="font-sans text-sm underline underline-offset-2 hover:opacity-70">{t("account.returns.new")}</a>
      </div>
      <ul className="space-y-3">
        {data.returns.map((r) => (
          <li key={r.id} className="border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{t("account.returns.orderTitle", { n: r.orderNumber })}</span>
              <span className="inline-block border border-line px-2 py-0.5 text-[0.6rem] uppercase tracking-wide">{RET_STATUS_NL[r.status] || r.status}</span>
            </div>
            <p className="mt-1 font-sans text-xs text-ink-soft">{r.method === "dhl" ? t("account.returns.methodDhl") : t("account.returns.methodStore")} · {r.refundType === "credit" ? t("account.returns.refundCredit") : t("account.returns.refundMoney")} · {nlDate(r.createdAt)}</p>
            {r.lines.length ? (
              <ul className="mt-3 space-y-1 font-sans text-sm text-ink-soft">
                {r.lines.map((l, i) => <li key={i}>{l.qty}× {l.title}{l.size ? ` — ${t("cart.added.sizeMeta", { size: l.size })}` : ""}</li>)}
              </ul>
            ) : null}
            {(r.dhlLabelUrl || r.dhlTracking || r.creditCode || (r.status === "completed" && r.refundType === "money")) && (
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 font-sans text-xs text-ink-soft">
                {r.dhlLabelUrl ? <a href={r.dhlLabelUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-70">{t("account.returns.returnLabel")}</a> : null}
                {r.dhlTracking ? <span>{t("account.returns.tracking", { code: r.dhlTracking })}</span> : null}
                {r.creditCode ? <span className="text-ink">{t("account.returns.creditLabel", { code: r.creditCode })}</span> : null}
                {r.status === "completed" && r.refundType === "money" ? <span>{t("account.returns.refunded", { amount: formatEuro(r.refundedCents) })}</span> : null}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Spaarpunten ──────────────────────────────────────────────────────────── */
/** Punten inwisselen voor een tegoedbon (Neon-native, geen SRS). 500 punten = € 25. */
function RedeemPoints({ available }: { available: number }) {
  const t = useT();
  const STEP = 500;
  const STEP_CENTS = 2500; // 500 punten = € 25 (server is bron van waarheid)
  const maxSteps = Math.floor(available / STEP);
  const [steps, setSteps] = useState(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ code: string; valueCents: number } | null>(null);
  const [error, setError] = useState("");

  if (maxSteps < 1) return null; // niet genoeg besteedbare punten → geen actie tonen
  const points = Math.min(steps, maxSteps) * STEP;

  async function redeem() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/account/redeem-points", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ points }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        setError(d.error || t("account.redeem.failed"));
        return;
      }
      setResult({ code: d.code, valueCents: d.valueCents });
    } catch {
      setError(t("puntenClaim.error.retry"));
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div className="border border-ink p-6">
        <p className="label-brand">{t("account.redeem.successTitle")}</p>
        <p className="mt-2 font-sans text-sm text-ink-soft">
          {t("account.redeem.successBody", { amount: formatEuro(result.valueCents) })}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <code className="bg-surface px-3 py-2 font-sans text-base tracking-wider">{result.code}</code>
          <button onClick={() => window.location.reload()} className="font-sans text-sm underline">
            {t("account.redeem.refresh")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-line p-6">
      <p className="label-brand">{t("account.redeem.title")}</p>
      <p className="mt-2 font-sans text-sm text-ink-soft">
        {t("account.redeem.intro", { points: STEP, amount: formatEuro(STEP_CENTS) })}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select
          value={steps}
          onChange={(e) => setSteps(Number(e.target.value))}
          disabled={loading}
          className="border border-line px-3 py-2 font-sans text-sm"
        >
          {Array.from({ length: maxSteps }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {t("account.redeem.option", { points: n * STEP, amount: formatEuro(n * STEP_CENTS) })}
            </option>
          ))}
        </select>
        <button
          onClick={redeem}
          disabled={loading}
          className="bg-ink px-5 py-2 font-sans text-sm text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? t("common.processing") : t("account.redeem.submit", { points })}
        </button>
      </div>
      {error && <p className="mt-2 font-sans text-sm text-danger">{error}</p>}
    </div>
  );
}

function Punten({ data, walletEnabled }: { data: Data; walletEnabled: boolean }) {
  const t = useT();
  return (
    <div className="space-y-6">
      <div className="border border-line p-6">
        <p className="label-brand">{t("account.points.balanceTitle")}</p>
        <p className="mt-2 font-display text-4xl font-light">{data.pointsAvailable} <span className="text-lg text-muted">{t("account.points.available")}</span></p>
        {data.pointsPending > 0 && (
          <p className="mt-1 font-sans text-sm text-ink-soft">{t("account.points.pending", { n: data.pointsPending })}</p>
        )}
        <p className="mt-2 font-sans text-sm text-ink-soft">{t("account.points.explainer")}</p>
        {walletEnabled && (
          <div className="mt-5">
            <AppleWalletButton />
            <p className="mt-2 font-sans text-xs text-muted">{t("account.points.walletHint")}</p>
          </div>
        )}
      </div>
      <RedeemPoints available={data.pointsAvailable} />
      {data.loyalty.length ? (
        <ul className="divide-y divide-line border-y border-line">
          {data.loyalty.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-3 font-sans text-sm">
              <span>{e.reason || t("account.points.mutation")} <span className="text-muted">· {nlDate(e.createdAt)}</span></span>
              <span className={e.points >= 0 ? "text-success" : "text-danger"}>{e.points >= 0 ? "+" : ""}{e.points}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title={t("account.points.emptyTitle")} body={t("account.points.emptyBody")} />
      )}
    </div>
  );
}

/* ── Vouchers ─────────────────────────────────────────────────────────────── */
function Vouchers({ data }: { data: Data }) {
  const t = useT();
  const hasGiftcards = data.giftcards.length > 0;
  const hasVouchers = data.vouchers.length > 0;
  if (!hasGiftcards && !hasVouchers) {
    return <Empty title={t("account.credit.emptyTitle")} body={t("account.credit.emptyBody")} />;
  }
  return (
    <div className="space-y-8">
      {hasGiftcards ? (
        <div>
          <p className="font-sans text-sm font-medium text-ink">{t("account.credit.giftcards")}</p>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2">
            {data.giftcards.map((g) => {
              const expired = Boolean(g.expiresAt && new Date(g.expiresAt).getTime() < Date.now());
              const depleted = g.balanceCents <= 0;
              return (
                <li key={g.id} className={`border p-5 ${depleted || expired ? "border-line opacity-60" : "border-ink"}`}>
                  <p className="font-sans text-xs uppercase tracking-wide text-muted">{t("account.credit.balance")}</p>
                  <p className="font-display text-2xl font-light">{formatEuro(g.balanceCents)}</p>
                  <p className="mt-0.5 font-sans text-xs text-muted">{t("account.credit.ofInitial", { amount: formatEuro(g.initialCents) })}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <code className="bg-surface px-2 py-1 font-sans text-sm tracking-wider">{g.code}</code>
                    <span className="font-sans text-xs text-muted">
                      {depleted ? t("account.credit.used") : expired ? t("account.credit.expired") : g.expiresAt ? t("account.credit.validUntil", { date: nlDate(g.expiresAt) }) : ""}
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
          {hasGiftcards ? <p className="font-sans text-sm font-medium text-ink">{t("account.credit.vouchers")}</p> : null}
          <ul className={`grid gap-4 sm:grid-cols-2 ${hasGiftcards ? "mt-3" : ""}`}>
            {data.vouchers.map((v) => {
              const expired = v.status !== "active" || (v.expiresAt && new Date(v.expiresAt).getTime() < Date.now());
              const value = v.kind === "percent" ? t("account.credit.percentOff", { pct: v.percentOff }) : formatEuro(v.valueCents);
              return (
                <li key={v.id} className={`border p-5 ${expired ? "border-line opacity-60" : "border-ink"}`}>
                  <p className="font-display text-2xl font-light">{value}</p>
                  <p className="mt-1 font-sans text-sm text-ink-soft">{v.description || t("account.credit.voucherFallback")}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <code className="bg-surface px-2 py-1 font-sans text-sm tracking-wider">{v.code}</code>
                    <span className="font-sans text-xs text-muted">
                      {expired ? t("account.credit.expired") : v.expiresAt ? t("account.credit.validUntil", { date: nlDate(v.expiresAt) }) : t("account.credit.noExpiry")}
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
// label/placeholder = i18n-keys; vertaald bij render via useT.
const SIZE_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: "colbert", label: "account.sizes.jacket", placeholder: "account.sizes.jacketPh" },
  { key: "broek", label: "account.sizes.trousers", placeholder: "account.sizes.trousersPh" },
  { key: "overhemd", label: "account.sizes.shirt", placeholder: "account.sizes.shirtPh" },
  { key: "schoen", label: "account.sizes.shoes", placeholder: "account.sizes.shoesPh" },
  { key: "pasvorm", label: "account.sizes.fit", placeholder: "account.sizes.fitPh" },
  { key: "lengte", label: "sizeAdvisor.height", placeholder: "account.sizes.heightPh" },
  { key: "gewicht", label: "sizeAdvisor.weight", placeholder: "account.sizes.weightPh" },
];

function Maten({ customer }: { customer: Customer }) {
  const t = useT();
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
        {t("account.sizes.intro1")} <span className="text-ink">&ldquo;{t("plp.filters.shopMySize")}&rdquo;</span>.{" "}
        {t("account.sizes.intro2")}
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {SIZE_FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="font-sans text-sm">{t(f.label)}</span>
            <input
              type="text"
              value={size[f.key] || ""}
              placeholder={t(f.placeholder)}
              onChange={(e) => setSize((p) => ({ ...p, [f.key]: e.target.value }))}
              className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
            />
          </label>
        ))}
        <label className="block sm:col-span-2">
          <span className="font-sans text-sm">{t("account.sizes.notes")}</span>
          <textarea
            rows={3}
            value={size.notities || ""}
            onChange={(e) => setSize((p) => ({ ...p, notities: e.target.value }))}
            className="mt-1 w-full resize-y border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
          />
        </label>
      </div>
      <button type="submit" disabled={state === "busy"} className="btn-primary mt-5">
        {state === "busy" ? t("account.form.saving") : state === "done" ? t("account.form.saved") : t("account.sizes.save")}
      </button>
    </form>
  );
}

/* ── Privacy (AVG: inzage & verwijdering) ─────────────────────────────────── */
function Privacy() {
  const t = useT();
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
        <h2 className="font-display text-xl">{t("account.privacy.downloadTitle")}</h2>
        <p className="mt-2 font-sans text-sm text-ink-soft">
          {t("account.privacy.downloadBody")}
        </p>
        <a href="/api/account/export-me" className="btn-ghost mt-4 inline-block">{t("account.privacy.downloadCta")}</a>
      </section>

      <section className="border border-danger/30 bg-danger/5 p-5">
        <h2 className="font-display text-xl text-ink">{t("account.privacy.deleteTitle")}</h2>
        <p className="mt-2 font-sans text-sm text-ink-soft">
          {t("account.privacy.deleteBody")}
        </p>
        <label className="mt-4 block">
          <span className="font-sans text-sm">{t("account.privacy.confirmPrefix")} <span className="font-semibold">VERWIJDER</span> {t("account.privacy.confirmSuffix")}</span>
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
          {state === "busy" ? t("common.processing") : t("account.privacy.deleteCta")}
        </button>
        {state === "error" ? (
          <p className="mt-2 font-sans text-sm text-danger">{t("account.privacy.deleteError")}</p>
        ) : null}
      </section>
    </div>
  );
}

/* ── Gegevens ─────────────────────────────────────────────────────────────── */
function Gegevens({ customer }: { customer: Customer }) {
  const t = useT();
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
          <span className="font-sans text-sm">{t("checkout.firstname")}</span>
          <input type="text" value={form.firstName} onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))} className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
        </label>
        <label className="block">
          <span className="font-sans text-sm">{t("checkout.lastname")}</span>
          <input type="text" value={form.lastName} onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))} className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
        </label>
        <label className="block">
          <span className="font-sans text-sm">{t("forms.contact.phone")}</span>
          <input type="tel" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
        </label>
        <label className="block">
          <span className="font-sans text-sm">{t("forms.contact.email")}</span>
          <input type="email" value={customer.email} disabled className="mt-1 w-full border border-line bg-surface px-3 py-2.5 font-sans text-sm text-muted" />
        </label>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={form.marketingOptIn} onChange={(e) => setForm((p) => ({ ...p, marketingOptIn: e.target.checked }))} />
        <span className="font-sans text-sm">{t("account.details.marketingOptIn")}</span>
      </label>
      <button type="submit" disabled={state === "busy"} className="btn-primary">
        {state === "busy" ? t("account.form.saving") : state === "done" ? <>{t("account.form.saved")} <CheckIcon className="inline-block h-3.5 w-3.5 align-[-2px]" /></> : t("account.details.save")}
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
