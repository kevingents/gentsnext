"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon } from "@/components/icons";
import { track } from "@/lib/track-client";
import { useT } from "@/components/i18n/locale-provider";
import { ORDER_STATUS_NL_KLANT, RETURN_STATUS_NL } from "@/lib/order-status";
import { formatEuro } from "@/lib/pricing";
import { PORTAL_URL } from "@/lib/portal";
import { COLOR_FAMILIES } from "@/lib/colors";
import {
  AGE_RANGES,
  SHOP_OCCASIONS,
  ageRangeFromBirthDate,
  profileChecklist,
  type ProfilePreferences,
} from "@/lib/profiel-voorkeuren";
import { AddressBook } from "@/components/account/address-book";
import { SupportTickets } from "@/components/account/support-tickets";
import { ProductCard } from "@/components/product-card";
import { AppleWalletButton } from "@/components/account/apple-wallet-button";
import { Bestellingen, type OrderRow, type StoreBuyRow } from "@/components/account/bestellingen";
import type { ProductCardData } from "@/lib/catalog";

/* ── Types (plain JSON van de server) ─────────────────────────────────────── */
// Order- en winkelbon-vorm staan bij het besteloverzicht dat ze rendert.
type Order = OrderRow;
type StoreBuy = StoreBuyRow;
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
  /** Stijlvoorkeuren (geboortedatum, kleuren, vaste winkel, gelegenheden). */
  preferences: ProfilePreferences;
  /** Medewerker? Bepaalt alleen of we de ingang naar de portal tonen. */
  isStaff?: boolean;
};
/** Eenmalige puntenbonus per actie — de server bepaalt stand en bedrag. */
export type BonusTask = { kind: "maatadvies" | "wallet" | "winkel" | "profiel"; points: number; done: boolean; earned: boolean };
type StoreOption = { pageHandle: string; title: string; city: string };
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

export function ProfileClient({
  customer,
  data,
  walletEnabled = false,
  bonuses = [],
  stores = [],
}: {
  customer: Customer;
  data: Data;
  walletEnabled?: boolean;
  bonuses?: BonusTask[];
  stores?: StoreOption[];
}) {
  const t = useT();
  const [tab, setTab] = useState<TabKey>("overzicht");
  const name = customer.firstName || customer.email.split("@")[0];
  // Alleen presentatie: de pagina achter de link controleert zelf opnieuw.

  return (
    <div className="mx-auto max-w-page px-gutter py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-brand">{t("login.eyebrow")}</p>
          <h1 className="mt-2 text-display-md">{t("account.hello", { name })}</h1>
        </div>
        <div className="flex items-center gap-4">
          {customer.isStaff ? (
            <a
              href={`${PORTAL_URL}/site`}
              className="font-sans text-sm text-ink underline hover:text-ink"
              rel="noopener noreferrer"
            >
              Portal
            </a>
          ) : null}
          <form action="/api/account/logout" method="post">
            <button type="submit" className="font-sans text-sm text-muted underline hover:text-ink">{t("account.logout")}</button>
          </form>
        </div>
      </div>

      {/* Tabs — op mobiel één horizontaal scrollbare rij (gewrapte rijen breken de
          actieve-tab-onderstreping); pas op lg mag er gewrapt worden. */}
      <nav
        className="mt-8 flex snap-x gap-1 overflow-x-auto whitespace-nowrap border-b border-line lg:flex-wrap lg:overflow-x-visible lg:whitespace-normal"
        aria-label={t("account.tabs.ariaLabel")}
      >
        {TABS.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            aria-current={tab === tb.key}
            className={`-mb-px shrink-0 snap-start border-b-2 px-4 py-2.5 font-sans text-sm transition-colors ${
              tab === tb.key ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t(tb.label)}
          </button>
        ))}
      </nav>

      <div className="mt-8">
        {tab === "overzicht" && <Overzicht customer={customer} data={data} bonuses={bonuses} onTab={setTab} />}
        {tab === "bestellingen" && <BestellingenTab data={data} />}
        {tab === "retouren" && <Retouren data={data} />}
        {tab === "punten" && <Punten data={data} walletEnabled={walletEnabled} bonuses={bonuses} onTab={setTab} />}
        {tab === "vouchers" && <Vouchers data={data} />}
        {tab === "maten" && <Maten customer={customer} />}
        {tab === "gegevens" && <Gegevens customer={customer} stores={stores} />}
        {tab === "adressen" && <Adressen data={data} />}
        {tab === "vragen" && <SupportTickets />}
        {tab === "privacy" && <Privacy />}
      </div>
    </div>
  );
}

/* ── Punten verdienen zonder te kopen ─────────────────────────────────────────
   Drie eenmalige acties die een retour helpen voorkomen: je maten bewaren, je
   pas in Wallet zetten en je profiel afmaken. Wat elke actie oplevert komt van
   de server (instelbaar), dus hier staat nergens een hardgecodeerde 50. Een
   bonus op 0 punten valt automatisch uit de lijst. */
const BONUS_COPY: Record<BonusTask["kind"], { title: string; body: string; cta: string; tab: TabKey }> = {
  maatadvies: { title: "account.bonus.size.title", body: "account.bonus.size.body", cta: "account.bonus.size.cta", tab: "maten" },
  wallet: { title: "account.bonus.wallet.title", body: "account.bonus.wallet.body", cta: "account.bonus.wallet.cta", tab: "punten" },
  winkel: { title: "account.bonus.store.title", body: "account.bonus.store.body", cta: "account.bonus.store.cta", tab: "gegevens" },
  profiel: { title: "account.bonus.profile.title", body: "account.bonus.profile.body", cta: "account.bonus.profile.cta", tab: "gegevens" },
};

/** Welke taken deze paginasessie al als "gezien" gemeld zijn (zie useEffect hieronder). */
const GEZIEN = new Set<string>();

function PuntenActies({ bonuses, onTab, compact = false }: { bonuses: BonusTask[]; onTab: (t: TabKey) => void; compact?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [ophalen, setOphalen] = useState(false);
  // Een bonus op 0 punten staat uit → helemaal niet tonen, ook niet als 'gedaan'.
  const zichtbaar = bonuses.filter((b) => b.points > 0);
  const open = zichtbaar.filter((b) => !b.done);
  const openKinds = open.map((b) => b.kind).join(",");

  /* Meten: welke openstaande taken heeft deze klant gezién? Zonder dat weet je
     alleen hoeveel mensen een bonus haalden, niet hoeveel er de kans op kregen —
     en dus niets over of de taak overtuigt. Het toekennen zélf loggen we NIET als
     event: dat staat al in het grootboek, en twee tellingen kunnen gaan verschillen.
     `GEZIEN` ontdubbelt binnen deze paginasessie: het blok staat zowel op het
     overzicht als op het puntentabblad, en dat is één kans, niet twee. */
  useEffect(() => {
    if (!openKinds) return;
    for (const kind of openKinds.split(",")) {
      if (GEZIEN.has(kind)) continue;
      GEZIEN.add(kind);
      track("bonus_shown", { handle: kind, path: "/account" });
    }
  }, [openKinds]);

  if (!zichtbaar.length) return null;
  // Op het overzicht alleen tonen zolang er nog iets te halen is.
  if (compact && !open.length) return null;
  const lijst = compact ? open : zichtbaar;
  const teHalen = open.reduce((n, b) => n + b.points, 0);
  /* Deed de klant dit al vóórdat de bonus bestond? Dan is de voorwaarde gehaald
     maar staat er nog niets in het grootboek — één knop haalt ze alsnog op. */
  const klaarOmOpTeHalen = open.filter((b) => b.earned);

  async function haalOp() {
    setOphalen(true);
    track("bonus_click", { handle: "ophalen", path: "/account" });
    try {
      await fetch("/api/account/punten-bonus", { method: "POST" });
      router.refresh();
    } finally {
      setOphalen(false);
    }
  }

  return (
    <div className="border border-line p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="label-brand">{t("account.bonus.title")}</p>
        {teHalen > 0 ? <p className="font-sans text-xs text-ink-soft">{t("account.bonus.toEarn", { n: teHalen })}</p> : null}
      </div>
      <p className="mt-1 font-sans text-sm text-ink-soft">{t("account.bonus.intro")}</p>
      {klaarOmOpTeHalen.length ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-line bg-surface p-4">
          <p className="font-sans text-sm text-ink-soft">
            {t("account.bonus.readyToClaim", { n: klaarOmOpTeHalen.reduce((n, b) => n + b.points, 0) })}
          </p>
          <button type="button" onClick={haalOp} disabled={ophalen} className="btn-primary shrink-0 !py-2 disabled:opacity-50">
            {ophalen ? t("common.processing") : t("account.bonus.claim")}
          </button>
        </div>
      ) : null}
      <ul className="mt-4 divide-y divide-line border-t border-line">
        {lijst.map((b) => {
          const copy = BONUS_COPY[b.kind];
          return (
            <li key={b.kind} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    b.done ? "border-success bg-success text-canvas" : "border-line text-transparent"
                  }`}
                >
                  <CheckIcon className="h-3 w-3" />
                </span>
                <div className="min-w-0">
                  <p className={`font-sans text-sm ${b.done ? "text-muted line-through" : "text-ink"}`}>{t(copy.title)}</p>
                  <p className="mt-0.5 font-sans text-xs text-ink-soft">{b.done ? t("account.bonus.done") : t(copy.body)}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className={`font-sans text-sm ${b.done ? "text-muted" : "text-ink"}`}>+{b.points}</span>
                {b.done ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      track("bonus_click", { handle: b.kind, path: "/account" });
                      onTab(copy.tab);
                    }}
                    className="btn-ghost !py-1.5 !text-xs"
                  >
                    {t(copy.cta)}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── Overzicht ────────────────────────────────────────────────────────────── */
function Overzicht({ customer, data, bonuses, onTab }: { customer: Customer; data: Data; bonuses: BonusTask[]; onTab: (t: TabKey) => void }) {
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

      <PuntenActies bonuses={bonuses} onTab={onTab} compact />

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
    ...data.onlineOrders.map((o) => ({ when: o.createdAt, kind: "Online", retour: false, label: t("account.orderNumber", { n: o.orderNumber }), total: o.totalCents })),
    ...data.storeBuys.map((s) => ({
      when: s.purchasedAt,
      kind: "Winkel",
      retour: s.kind === "retour",
      label: s.storeName || t("account.activity.storePurchase"),
      total: s.totalCents,
    })),
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
              <span className={`inline-block px-2 py-0.5 text-[0.6rem] uppercase tracking-wide ${i.kind === "Winkel" ? "bg-ink text-canvas" : "border border-line"}`}>
                {i.retour ? t("account.activity.storeReturn") : i.kind === "Winkel" ? t("account.activity.store") : t("account.activity.online")}
              </span>
              <span>{i.label}</span>
            </span>
            <span className="text-ink-soft">{nlDate(i.when)} · {formatEuro(i.total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Bestellingen: één tijdlijn van online orders + winkelbonnen ───────── */
function BestellingenTab({ data }: { data: Data }) {
  return (
    <Bestellingen
      onlineOrders={data.onlineOrders}
      storeBuys={data.storeBuys}
      returns={data.returns}
      returnWindowDays={data.returnWindowDays}
    />
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

function Punten({ data, walletEnabled, bonuses, onTab }: { data: Data; walletEnabled: boolean; bonuses: BonusTask[]; onTab: (t: TabKey) => void }) {
  const t = useT();
  const walletBonus = bonuses.find((b) => b.kind === "wallet");
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
            <p className="mt-2 font-sans text-xs text-muted">
              {t("account.points.walletHint")}
              {walletBonus && !walletBonus.done && walletBonus.points > 0
                ? ` ${t("account.bonus.walletInline", { n: walletBonus.points })}`
                : ""}
            </p>
          </div>
        )}
      </div>
      <PuntenActies bonuses={bonuses} onTab={onTab} />
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
  const router = useRouter();
  const [size, setSize] = useState<Record<string, string>>(customer.sizeProfile || {});
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [bonus, setBonus] = useState(0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    // res.ok checken (4xx zoals een verlopen sessie mag geen "Opgeslagen" tonen)
    // en netwerkfouten opvangen — anders blijft de knop eeuwig op "Opslaan…".
    try {
      const res = await fetch("/api/account/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "size", sizeProfile: size }),
      });
      if (!res.ok) {
        setState("error");
        return;
      }
      const d = (await res.json().catch(() => ({}))) as { bonuses?: { points: number }[] };
      setState("done");
      const punten = puntenUit(d.bonuses);
      if (punten) {
        setBonus(punten);
        // Saldo, puntenhistorie en het takenlijstje komen van de server.
        router.refresh();
      }
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("error");
    }
  }

  return (
    <form onSubmit={save} className="max-w-2xl">
      <p className="font-sans text-sm text-ink-soft">
        {t("account.sizes.intro1")} <span className="text-ink">&ldquo;{t("plp.filters.shopMySize")}&rdquo;</span>.{" "}
        {t("account.sizes.intro2")}
      </p>
      {bonus > 0 ? <BonusMelding points={bonus} /> : null}
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
      {state === "error" ? (
        <p role="alert" className="mt-2 font-sans text-sm text-danger">{t("account.form.saveError")}</p>
      ) : null}
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
function Gegevens({ customer, stores }: { customer: Customer; stores: StoreOption[] }) {
  const t = useT();
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: customer.firstName, lastName: customer.lastName, phone: customer.phone,
    marketingOptIn: customer.marketingOptIn,
  });
  const [prefs, setPrefs] = useState<ProfilePreferences>({
    birthDate: customer.preferences?.birthDate ?? "",
    ageRange: customer.preferences?.ageRange ?? "",
    favoriteColors: customer.preferences?.favoriteColors ?? [],
    favoriteStore: customer.preferences?.favoriteStore ?? "",
    occasions: customer.preferences?.occasions ?? [],
    styleNote: customer.preferences?.styleNote ?? "",
  });
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [bonus, setBonus] = useState(0);

  // Live meelezende checklist — de klant ziet wat er nog mist vóór hij opslaat.
  const checks = profileChecklist({ ...form, preferences: prefs });
  const open = checks.filter((c) => !c.done).length;
  // Geboortedatum ingevuld? Dan is de leeftijdsgroep afgeleid en niet los te kiezen.
  const afgeleideGroep = prefs.birthDate ? ageRangeFromBirthDate(prefs.birthDate) : "";

  const toggle = (veld: "favoriteColors" | "occasions", key: string) =>
    setPrefs((p) => {
      const huidig = p[veld] ?? [];
      return { ...p, [veld]: huidig.includes(key) ? huidig.filter((k) => k !== key) : [...huidig, key] };
    });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setBonus(0);
    // res.ok checken + netwerkfouten opvangen — geen vals "Opgeslagen" bij 4xx/5xx.
    try {
      // Eerst de persoonsgegevens, dan de voorkeuren: de bonus-check bij het
      // tweede verzoek ziet zo de zojuist opgeslagen naam en telefoon staan.
      const res = await fetch("/api/account/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        setState("error");
        return;
      }
      const eerste = (await res.json().catch(() => ({}))) as { bonuses?: { points: number }[] };
      const res2 = await fetch("/api/account/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "preferences", preferences: prefs }),
      });
      if (!res2.ok) {
        setState("error");
        return;
      }
      const tweede = (await res2.json().catch(() => ({}))) as { bonuses?: { points: number }[] };
      // Optellen, niet "de eerste die er is": één opslag kan de winkel-bonus én
      // de profielbonus opleveren, en dan hoort er 100 te staan, geen 50.
      const punten = puntenUit(eerste.bonuses) + puntenUit(tweede.bonuses);
      setState("done");
      if (punten) {
        setBonus(punten);
        router.refresh();
      }
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("error");
    }
  }

  return (
    <form onSubmit={save} className="max-w-xl space-y-4">
      {bonus > 0 ? <BonusMelding points={bonus} /> : null}
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

      {/* ── Voorkeuren ─────────────────────────────────────────────────────────
          Hoe beter dit staat, hoe gerichter we tonen wat er in jouw maat, kleur
          en winkel ligt — en hoe minder er terug hoeft. De nieuwsbrief-opt-in
          hierboven telt bewust NIET mee voor de bonus: toestemming die je met
          punten koopt is geen vrije toestemming. */}
      <div className="!mt-8 border-t border-line pt-6">
        <p className="label-brand">{t("account.prefs.title")}</p>
        <p className="mt-1 font-sans text-sm text-ink-soft">{t("account.prefs.intro")}</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="font-sans text-sm">{t("account.prefs.birthDate")}</span>
            {/* Geen `max`-attribuut: dat zou uit de "datum van nu" komen en
                server en browser kunnen daar rond middernacht over verschillen
                (hydratiefout). De server weigert een datum in de toekomst. */}
            <input
              type="date"
              value={prefs.birthDate || ""}
              onChange={(e) => setPrefs((p) => ({ ...p, birthDate: e.target.value }))}
              className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
            />
            <span className="mt-1 block font-sans text-xs text-muted">{t("account.prefs.birthDateHint")}</span>
          </label>
          <label className="block">
            <span className="font-sans text-sm">{t("account.prefs.ageRange")}</span>
            <select
              value={afgeleideGroep || prefs.ageRange || ""}
              disabled={Boolean(afgeleideGroep)}
              onChange={(e) => setPrefs((p) => ({ ...p, ageRange: e.target.value }))}
              className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none disabled:bg-surface disabled:text-muted"
            >
              <option value="">{t("account.prefs.choose")}</option>
              {AGE_RANGES.map((a) => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </select>
            <span className="mt-1 block font-sans text-xs text-muted">
              {afgeleideGroep ? t("account.prefs.ageFromBirthDate") : t("account.prefs.ageRangeHint")}
            </span>
          </label>
        </div>

        <fieldset className="mt-5">
          <legend className="font-sans text-sm">{t("account.prefs.colors")}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {COLOR_FAMILIES.filter((c) => c.key !== "multi").map((c) => {
              const aan = (prefs.favoriteColors ?? []).includes(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => toggle("favoriteColors", c.key)}
                  aria-pressed={aan}
                  className={`flex items-center gap-2 border px-3 py-1.5 font-sans text-sm transition-colors ${aan ? "border-ink bg-ink text-canvas" : "border-line bg-canvas hover:border-ink"}`}
                >
                  <span aria-hidden className="h-3.5 w-3.5 rounded-full border border-line" style={{ backgroundColor: c.hex }} />
                  {c.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="mt-5">
          <legend className="font-sans text-sm">{t("account.prefs.occasions")}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {SHOP_OCCASIONS.map((o) => {
              const aan = (prefs.occasions ?? []).includes(o.key);
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => toggle("occasions", o.key)}
                  aria-pressed={aan}
                  className={`border px-3 py-1.5 font-sans text-sm transition-colors ${aan ? "border-ink bg-ink text-canvas" : "border-line bg-canvas hover:border-ink"}`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="mt-5 block">
          <span className="font-sans text-sm">{t("account.prefs.store")}</span>
          <select
            value={prefs.favoriteStore || ""}
            onChange={(e) => setPrefs((p) => ({ ...p, favoriteStore: e.target.value }))}
            className="mt-1 w-full border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
          >
            <option value="">{t("account.prefs.choose")}</option>
            {stores.map((s) => (
              <option key={s.pageHandle} value={s.pageHandle}>{s.title}</option>
            ))}
          </select>
          <span className="mt-1 block font-sans text-xs text-muted">{t("account.prefs.storeHint")}</span>
        </label>

        <label className="mt-5 block">
          <span className="font-sans text-sm">{t("account.prefs.note")}</span>
          <textarea
            rows={2}
            value={prefs.styleNote || ""}
            maxLength={400}
            placeholder={t("account.prefs.notePh")}
            onChange={(e) => setPrefs((p) => ({ ...p, styleNote: e.target.value }))}
            className="mt-1 w-full resize-y border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
          />
        </label>

        <ProfielChecklist checks={checks} open={open} />
      </div>

      <button type="submit" disabled={state === "busy"} className="btn-primary">
        {state === "busy" ? t("account.form.saving") : state === "done" ? <>{t("account.form.saved")} <CheckIcon className="inline-block h-3.5 w-3.5 align-[-2px]" /></> : t("account.details.save")}
      </button>
      {state === "error" ? (
        <p role="alert" className="font-sans text-sm text-danger">{t("account.form.saveError")}</p>
      ) : null}
    </form>
  );
}

/* ── Adresboek ────────────────────────────────────────────────────────────── */
function Adressen({ data }: { data: Data }) {
  return <AddressBook addresses={data.addresses} />;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/** Totaal aan punten dat één opslag opleverde (0, één of meerdere bonussen). */
function puntenUit(bonuses: { points: number }[] | undefined): number {
  return (bonuses ?? []).reduce((n, b) => n + (Number(b?.points) || 0), 0);
}

/** "+N punten bijgeschreven" na een opslag die een bonus opleverde. */
function BonusMelding({ points }: { points: number }) {
  const t = useT();
  return (
    <p role="status" className="flex items-center gap-2 border border-success/40 bg-success/5 px-4 py-3 font-sans text-sm text-ink">
      <CheckIcon className="h-4 w-4 shrink-0 text-success" />
      {t("account.bonus.awarded", { n: points })}
    </p>
  );
}

/** Wat er nog mist voor "profiel compleet" — meeschrijvend terwijl je invult. */
function ProfielChecklist({ checks, open }: { checks: { key: string; labelKey: string; done: boolean }[]; open: number }) {
  const t = useT();
  return (
    <div className="mt-6 border border-line bg-surface p-4">
      <p className="font-sans text-sm font-medium text-ink">
        {open === 0 ? t("account.prefs.checklistComplete") : t("account.prefs.checklistOpen", { n: open })}
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {checks.map((c) => (
          <li key={c.key} className={`flex items-center gap-1.5 font-sans text-xs ${c.done ? "text-muted" : "text-ink"}`}>
            <CheckIcon className={`h-3 w-3 ${c.done ? "text-success" : "text-line"}`} />
            {t(c.labelKey)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="border border-dashed border-line p-10 text-center">
      <p className="font-display text-xl font-light">{title}</p>
      <p className="mx-auto mt-2 max-w-md font-sans text-sm text-ink-soft">{body}</p>
    </div>
  );
}
