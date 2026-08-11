"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/i18n/locale-provider";
import { ORDER_STATUS_NL_KLANT } from "@/lib/order-status";
import { formatEuro } from "@/lib/pricing";
import { ReorderButton } from "@/components/order/reorder-button";

/* ── Types (plain JSON van de server) ─────────────────────────────────────── */
export type OrderLineRow = {
  title: string; size: string; color: string; quantity: number; unitPriceCents: number;
  productHandle?: string; imageUrl?: string;
};
export type ShipmentRow = {
  store: string; isWarehouse: boolean;
  /** null = geen uitspraak (magazijn meldt niet apart gereed). */
  gereed: boolean | null;
  lines: { title: string; qty: number }[];
};
export type OrderRow = {
  id: string; orderNumber: string; status: string; createdAt: string; totalCents: number;
  lines: OrderLineRow[]; shipments?: ShipmentRow[];
  deliveryMethod?: string; pickupStore?: string;
};
export type StoreBuyRow = {
  id: string; storeName: string; purchasedAt: string; totalCents: number;
  kind?: "sale" | "retour"; pointsEarned: number;
  lines: { title: string; size?: string; color?: string; qty?: number; unitPriceCents?: number; imageUrl?: string; handle?: string }[];
};
export type ReturnRowLite = { orderNumber: string; status: string };

type Filter = "alles" | "online" | "winkel";

/** Eén rij in de tijdlijn — online order óf winkelbon, chronologisch door elkaar. */
type Item =
  | { soort: "online"; when: string; order: OrderRow }
  | { soort: "winkel"; when: string; buy: StoreBuyRow };

function nlDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const BETAALD = ["paid", "shipped", "ready_pickup", "delivered"];
const MISLUKT = ["failed", "expired", "canceled", "refunded"];

/* ── Bouwstenen ───────────────────────────────────────────────────────────── */

/** Productminiatuur; valt terug op een neutrale plaatshouder zodat de rij niet verspringt. */
function Thumb({ src, alt }: { src?: string; alt: string }) {
  return (
    <span className="block h-14 w-11 shrink-0 overflow-hidden bg-surface">
      {src ? (
        // Externe CDN-URL's met wisselende hosts → gewone img, geen next/image-loader.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" className="h-full w-full object-cover" />
      ) : null}
    </span>
  );
}

/** Voortgangsbalk besteld → betaald → verzonden → geleverd. */
function StatusBalk({ status, isPickup }: { status: string; isPickup: boolean }) {
  const t = useT();
  const stappen = [
    { key: "ordered", label: t("account.orders.steps.ordered"), done: true },
    { key: "paid", label: t("account.orders.steps.paid"), done: BETAALD.includes(status) },
    {
      key: "shipped",
      label: isPickup ? t("account.orders.steps.pickup") : t("account.orders.steps.shipped"),
      done: ["shipped", "ready_pickup", "delivered"].includes(status),
    },
    { key: "delivered", label: t("account.orders.steps.delivered"), done: status === "delivered" },
  ];
  return (
    <ol className="mt-3 flex gap-1.5" aria-label={t("account.orders.progress")}>
      {stappen.map((s) => (
        <li key={s.key} className="flex-1">
          <span className={`block h-1 ${s.done ? "bg-ink" : "bg-line"}`} />
          <span className={`mt-1.5 block font-sans text-[0.65rem] uppercase tracking-wide ${s.done ? "text-ink" : "text-muted"}`}>
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Bij een order uit meerdere locaties: wat staat er al klaar en wat nog niet. */
function Deelzendingen({ shipments }: { shipments: ShipmentRow[] }) {
  const t = useT();
  if (shipments.length < 2) return null;
  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      {shipments.map((s, i) => (
        <div key={i} className="font-sans text-xs">
          <p className="text-ink">
            {t("account.orders.shipmentOf", { n: i + 1, total: shipments.length })} ·{" "}
            {s.isWarehouse ? t("account.orders.fromWarehouse") : t("account.orders.fromStore", { store: s.store.replace(/^GENTS\s+/i, "") })}
            {s.gereed === null ? null : (
              <span className={s.gereed ? "text-success" : "text-muted"}>
                {" "}· {s.gereed ? t("account.orders.shipmentReady") : t("account.orders.shipmentPending")}
              </span>
            )}
          </p>
          <p className="text-muted">{s.lines.map((l) => `${l.qty}× ${l.title}`).join(", ")}</p>
        </div>
      ))}
    </div>
  );
}

/** Vraag over déze bestelling — gaat naar dezelfde AI-service als de servicepagina. */
function OrderVraag({ orderNumber }: { orderNumber: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [tekst, setTekst] = useState("");
  const [busy, setBusy] = useState(false);
  const [antwoord, setAntwoord] = useState("");

  async function stuur() {
    const q = tekst.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Het ordernummer meesturen in de vraagtekst: de assistent haalt daar de
        // echte orderstatus bij (server-side, op het sessie-e-mailadres).
        body: JSON.stringify({ question: `Vraag over bestelling ${orderNumber}: ${q}` }),
      });
      const d = await r.json().catch(() => null);
      setAntwoord(d?.answer || t("account.orders.askSent"));
      setTekst("");
    } catch {
      setAntwoord(t("account.orders.askError"));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost">
        {t("account.orders.askQuestion")}
      </button>
    );
  }
  return (
    <div className="w-full">
      <textarea
        value={tekst}
        onChange={(e) => setTekst(e.target.value)}
        rows={2}
        placeholder={t("account.orders.askPlaceholder")}
        className="w-full resize-y border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={stuur} disabled={busy || !tekst.trim()} className="btn-primary">
          {busy ? t("common.processing") : t("account.orders.askSend")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="font-sans text-sm text-muted underline">
          {t("common.cancel")}
        </button>
      </div>
      {antwoord ? <p className="mt-2 font-sans text-sm text-ink-soft">{antwoord}</p> : null}
    </div>
  );
}

/* ── Eén online bestelling ────────────────────────────────────────────────── */
function OnlineKaart({ order, returns, windowDays }: { order: OrderRow; returns: ReturnRowLite[]; windowDays: number }) {
  const t = useT();
  const betaald = BETAALD.includes(order.status);
  const mislukt = MISLUKT.includes(order.status);
  const lopendeRetour = returns.find((r) => r.orderNumber === order.orderNumber);
  // Retour mag zolang de order betaald is én binnen het venster valt; een lopende
  // retour vervangt de knop door z'n status (twee retouren op één order is ruis).
  const magRetour =
    betaald && !lopendeRetour && Date.now() - new Date(order.createdAt).getTime() <= windowDays * 86400000;

  return (
    <li className="border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          <span className="inline-block border border-line px-2 py-0.5 text-[0.6rem] uppercase tracking-wide">
            {t("account.activity.online")}
          </span>
          {t("account.orderNumber", { n: order.orderNumber })}
        </span>
        <span className="font-sans text-sm text-muted">{nlDate(order.createdAt)}</span>
      </div>
      <p className="mt-1 font-sans text-xs text-ink-soft">
        {ORDER_STATUS_NL_KLANT[order.status] || order.status} · {formatEuro(order.totalCents)}
      </p>

      {mislukt ? null : <StatusBalk status={order.status} isPickup={order.deliveryMethod === "pickup"} />}

      {order.lines.length ? (
        <ul className="mt-4 space-y-2.5">
          {order.lines.map((l, i) => (
            <li key={i} className="flex items-center gap-3">
              <Thumb src={l.imageUrl} alt={l.title} />
              <span className="min-w-0 font-sans text-sm">
                {l.productHandle ? (
                  <Link href={`/products/${l.productHandle}`} className="text-ink underline-offset-4 hover:underline">{l.title}</Link>
                ) : (
                  <span className="text-ink">{l.title}</span>
                )}
                <span className="block text-xs text-muted">
                  {[l.quantity > 1 ? `${l.quantity}×` : "", l.size ? t("cart.added.sizeMeta", { size: l.size }) : "", l.color]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {order.shipments?.length ? <Deelzendingen shipments={order.shipments} /> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href={`/bestelling/${encodeURIComponent(order.orderNumber)}`} className="btn-ghost">
          {t("account.orders.track")}
        </Link>
        {betaald ? <ReorderButton orderNumber={order.orderNumber} /> : null}
        {betaald ? (
          <a href={`/api/account/factuur/${encodeURIComponent(order.orderNumber)}`} className="btn-ghost" target="_blank" rel="noopener">
            {t("account.orders.invoice")}
          </a>
        ) : null}
        {magRetour ? (
          <Link href={`/retourneren?order=${encodeURIComponent(order.orderNumber)}`} className="btn-ghost">
            {t("account.orders.startReturn")}
          </Link>
        ) : null}
        <OrderVraag orderNumber={order.orderNumber} />
      </div>
      {lopendeRetour ? (
        <p className="mt-2 font-sans text-xs text-muted">{t("account.orders.returnRunning")}</p>
      ) : null}
    </li>
  );
}

/* ── Eén winkelaankoop ────────────────────────────────────────────────────── */
function WinkelKaart({ buy }: { buy: StoreBuyRow }) {
  const t = useT();
  const isRetour = buy.kind === "retour";
  return (
    <li className="border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          <span className="inline-block bg-ink px-2 py-0.5 text-[0.6rem] uppercase tracking-wide text-canvas">
            {isRetour ? t("account.activity.storeReturn") : t("account.activity.store")}
          </span>
          {buy.storeName || t("account.activity.storePurchase")}
        </span>
        <span className="font-sans text-sm text-muted">{nlDate(buy.purchasedAt)}</span>
      </div>
      <p className="mt-1 font-sans text-xs text-ink-soft">
        {formatEuro(buy.totalCents)}
        {buy.pointsEarned ? ` · ${t("puntenClaim.success.points", { points: buy.pointsEarned })}` : ""}
      </p>
      {buy.lines?.length ? (
        <ul className="mt-4 space-y-2.5">
          {buy.lines.map((l, i) => (
            <li key={i} className="flex items-center gap-3">
              <Thumb src={l.imageUrl} alt={l.title} />
              <span className="min-w-0 font-sans text-sm">
                {l.handle ? (
                  <Link href={`/products/${l.handle}`} className="text-ink underline-offset-4 hover:underline">{l.title}</Link>
                ) : (
                  <span className="text-ink">{l.title}</span>
                )}
                <span className="block text-xs text-muted">
                  {[l.qty && l.qty > 1 ? `${l.qty}×` : "", l.size ? t("cart.added.sizeMeta", { size: l.size }) : "", l.color]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {/* Retour van een winkelaankoop loopt via de winkel: de bon is daar leidend,
          dus geen self-service-knop maar de plek waar het moet gebeuren. */}
      {!isRetour ? (
        <p className="mt-4 font-sans text-xs text-muted">
          {t("account.orders.storeReturnNote", { store: buy.storeName || "" })}
        </p>
      ) : null}
    </li>
  );
}

/* ── De tijdlijn ──────────────────────────────────────────────────────────── */
export function Bestellingen({
  onlineOrders,
  storeBuys,
  returns,
  returnWindowDays,
}: {
  onlineOrders: OrderRow[];
  storeBuys: StoreBuyRow[];
  returns: ReturnRowLite[];
  returnWindowDays: number;
}) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("alles");

  const items = useMemo<Item[]>(() => {
    const alles: Item[] = [
      ...onlineOrders.map((o) => ({ soort: "online" as const, when: o.createdAt, order: o })),
      ...storeBuys.map((b) => ({ soort: "winkel" as const, when: b.purchasedAt, buy: b })),
    ];
    return alles
      .filter((i) => filter === "alles" || (filter === "online" ? i.soort === "online" : i.soort === "winkel"))
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  }, [onlineOrders, storeBuys, filter]);

  if (!onlineOrders.length && !storeBuys.length) {
    return (
      <div className="border border-line p-8 text-center">
        <p className="font-display text-lg">{t("account.orders.emptyTitle")}</p>
        <p className="mt-1 font-sans text-sm text-ink-soft">{t("account.orders.emptyBody")}</p>
      </div>
    );
  }

  const knoppen: { key: Filter; label: string; aantal: number }[] = [
    { key: "alles", label: t("account.orders.filterAll"), aantal: onlineOrders.length + storeBuys.length },
    { key: "online", label: t("account.orders.filterOnline"), aantal: onlineOrders.length },
    { key: "winkel", label: t("account.orders.filterStore"), aantal: storeBuys.length },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2">
        {knoppen.map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={() => setFilter(k.key)}
            aria-pressed={filter === k.key}
            className={`px-3 py-1.5 font-sans text-sm ${
              filter === k.key ? "bg-ink text-canvas" : "border border-line text-ink-soft hover:text-ink"
            }`}
          >
            {k.label} <span className="opacity-60">{k.aantal}</span>
          </button>
        ))}
      </div>

      {items.length ? (
        <ul className="space-y-3">
          {items.map((i) =>
            i.soort === "online" ? (
              <OnlineKaart key={i.order.id} order={i.order} returns={returns} windowDays={returnWindowDays} />
            ) : (
              <WinkelKaart key={i.buy.id} buy={i.buy} />
            ),
          )}
        </ul>
      ) : (
        <p className="font-sans text-sm text-muted">{t("account.orders.filterEmpty")}</p>
      )}
    </div>
  );
}
