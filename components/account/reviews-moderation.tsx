"use client";

import Link from "next/link";
import { useState } from "react";
import { RatingStars } from "@/components/rating-stars";

type Item = {
  id: string;
  productHandle: string;
  authorName: string;
  rating: number;
  title: string;
  body: string;
  fit: string;
  email: string;
  createdAt: string;
};

const dateFmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" });

export function ReviewsModeration({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, status: "published" | "rejected") {
    setBusy(id);
    try {
      const r = await fetch("/api/account/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (r.ok) setItems((p) => p.filter((x) => x.id !== id));
    } finally {
      setBusy(null);
    }
  }

  if (!items.length) {
    return <p className="mt-6 font-sans text-sm text-muted">Geen reviews in de wachtrij.</p>;
  }

  return (
    <ul className="mt-6 space-y-4">
      {items.map((r) => (
        <li key={r.id} className="border border-line p-4">
          <div className="flex items-center justify-between gap-3">
            <RatingStars rating={{ value: r.rating, count: 0 }} size="sm" showCount={false} />
            <Link href={`/products/${r.productHandle}`} className="truncate font-sans text-xs text-muted underline hover:text-ink">
              {r.productHandle}
            </Link>
          </div>
          {r.title ? <p className="mt-2 font-sans text-sm font-medium text-ink">{r.title}</p> : null}
          {r.body ? <p className="mt-1 whitespace-pre-line font-sans text-sm text-ink-soft">{r.body}</p> : null}
          <p className="mt-2 font-sans text-xs text-muted">
            {[r.authorName, r.email, r.fit && `valt ${r.fit}`, dateFmt.format(new Date(r.createdAt))].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => act(r.id, "published")} disabled={busy === r.id} className="btn-primary !px-3 !py-1.5 text-sm">
              Plaatsen
            </button>
            <button type="button" onClick={() => act(r.id, "rejected")} disabled={busy === r.id} className="btn-ghost !px-3 !py-1.5 text-sm">
              Afwijzen
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
