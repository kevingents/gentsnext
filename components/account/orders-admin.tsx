"use client";

import { useState } from "react";
import { formatEuro } from "@/lib/pricing";

type Order = {
  id: string; orderNumber: string; status: string; email: string; name: string;
  city: string; totalCents: number; deliveryMethod: string; fulfillmentStatus: string; createdAt: string;
};

const STATUS_NL: Record<string, string> = {
  open: "Open", paid: "Betaald", shipped: "Verzonden", ready_pickup: "Klaar om af te halen",
  refunded: "Terugbetaald", canceled: "Geannuleerd", failed: "Mislukt", expired: "Verlopen", review: "Review",
};

export function OrdersAdmin({ orders }: { orders: Order[] }) {
  const [rows, setRows] = useState(orders);
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(id: string, status: string) {
    setBusy(id + status);
    try {
      const r = await fetch("/api/account/order-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: id, status }),
      });
      if (r.ok) setRows((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length) return <p className="mt-8 font-sans text-muted">Nog geen bestellingen.</p>;

  return (
    <div className="mt-8 space-y-3">
      {rows.map((o) => (
        <div key={o.id} className="border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-medium">{o.orderNumber}</span>
              <span className="ml-2 font-sans text-sm text-muted">{o.name} · {o.city}</span>
            </div>
            <div className="flex items-center gap-3 font-sans text-sm">
              <span className="text-muted">{formatEuro(o.totalCents)}</span>
              {o.deliveryMethod === "express" ? <span className="bg-ink px-2 py-0.5 text-[0.6rem] uppercase text-canvas">Express</span> : null}
              <span className="border border-line px-2 py-0.5 text-xs">{STATUS_NL[o.status] || o.status}</span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Action label="Markeer verzonden" onClick={() => setStatus(o.id, "shipped")} busy={busy === o.id + "shipped"} disabled={o.status === "shipped"} />
            <Action label="Klaar om af te halen" onClick={() => setStatus(o.id, "ready_pickup")} busy={busy === o.id + "ready_pickup"} disabled={o.status === "ready_pickup"} />
            <span className="ml-auto self-center font-sans text-xs text-muted">Fulfilment: {o.fulfillmentStatus}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Action({ label, onClick, busy, disabled }: { label: string; onClick: () => void; busy: boolean; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="btn-ghost !px-3 !py-1.5 text-xs disabled:opacity-40"
    >
      {busy ? "…" : label}
    </button>
  );
}
