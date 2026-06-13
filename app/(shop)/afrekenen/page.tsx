"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/components/cart/cart-context";
import { formatEuro } from "@/lib/pricing";

const FIELDS = [
  { name: "firstName", label: "Voornaam", col: 1 },
  { name: "lastName", label: "Achternaam", col: 1 },
  { name: "email", label: "E-mailadres", col: 2, type: "email" },
  { name: "phone", label: "Telefoon (optioneel)", col: 2, type: "tel", optional: true },
  { name: "street", label: "Straat", col: 1 },
  { name: "houseNumber", label: "Huisnr.", col: 1 },
  { name: "postalCode", label: "Postcode", col: 1 },
  { name: "city", label: "Plaats", col: 1 },
] as const;

export default function AfrekenenPage() {
  const cart = useCart();
  const [form, setForm] = useState<Record<string, string>>({});
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const shippingCents = cart.subtotalCents >= 7500 ? 0 : cart.subtotalCents > 0 ? 495 : 0;
  const totalCents = cart.subtotalCents + shippingCents;

  if (cart.lines.length === 0 && !notice) {
    return (
      <div className="mx-auto max-w-page px-gutter py-20 text-center">
        <h1 className="text-display-md">Je winkelwagen is leeg</h1>
        <Link href="/collections/pakken" className="btn-primary mt-8 inline-flex">
          Begin met shoppen
        </Link>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!agree) {
      setError("Accepteer de algemene voorwaarden om te bestellen.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: form,
          items: cart.lines.map((l) => ({
            sku: l.sku,
            qty: l.qty,
            groupId: l.groupId,
            roleLabel: l.roleLabel,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Er ging iets mis.");
        return;
      }
      if (data.configured && data.checkoutUrl) {
        cart.clear();
        window.location.href = data.checkoutUrl; // door naar Mollie (iDEAL)
      } else {
        setNotice(
          `${data.message} Je bestelnummer is ${data.orderNumber}. We nemen contact op zodra betalen mogelijk is.`
        );
      }
    } catch {
      setError("Kon de bestelling niet versturen. Probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  if (notice) {
    return (
      <div className="mx-auto max-w-page px-gutter py-20">
        <div className="max-w-xl">
          <p className="label-brand">Bedankt</p>
          <h1 className="mt-2 text-display-md">Je bestelling is genoteerd</h1>
          <p className="mt-4 font-sans text-ink-soft">{notice}</p>
          <Link href="/" className="btn-ghost mt-8">
            Terug naar home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <h1 className="text-display-md">Afrekenen</h1>
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Formulier */}
        <form onSubmit={submit} noValidate>
          <p className="label-brand">Contact & bezorgadres</p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            {FIELDS.map((f) => (
              <label key={f.name} className={f.col === 2 ? "col-span-2 block" : "block"}>
                <span className="font-sans text-sm text-ink">{f.label}</span>
                <input
                  type={"type" in f ? f.type : "text"}
                  value={form[f.name] || ""}
                  onChange={(e) => setForm((p) => ({ ...p, [f.name]: e.target.value }))}
                  required={!("optional" in f && f.optional)}
                  className="mt-1.5 w-full border border-line bg-canvas px-4 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
                />
              </label>
            ))}
            <label className="col-span-2 block">
              <span className="font-sans text-sm text-ink">Land</span>
              <input
                value="Nederland"
                readOnly
                className="mt-1.5 w-full border border-line bg-surface px-4 py-2.5 font-sans text-sm text-muted"
              />
            </label>
          </div>

          <label className="mt-6 flex items-start gap-2 font-sans text-sm">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 accent-ink" />
            <span className="text-ink-soft">
              Ik ga akkoord met de{" "}
              <Link href="/pages/algemene-voorwaarden" className="text-ink underline">algemene voorwaarden</Link>{" "}
              en het{" "}
              <Link href="/pages/retourneren" className="text-ink underline">herroepingsrecht</Link> (14 dagen bedenktijd).
            </span>
          </label>

          {error ? (
            <p role="alert" className="mt-4 font-sans text-sm text-danger">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={busy} className="btn-primary mt-6 w-full sm:w-auto">
            {busy ? "Bezig…" : "Bestelling met betaalverplichting"}
          </button>
          <p className="mt-3 font-sans text-xs text-muted">
            Je betaalt veilig met iDEAL. Totaalbedrag incl. btw, gratis retour binnen 14 dagen.
          </p>
        </form>

        {/* Overzicht */}
        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <div className="border border-line p-5">
            <p className="label-brand mb-3">Je bestelling</p>
            <ul className="space-y-3">
              {cart.lines.map((l) => (
                <li key={l.id} className="flex gap-3">
                  <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-card bg-surface">
                    {l.imageUrl ? <Image src={l.imageUrl} alt={l.title} fill sizes="48px" className="object-cover" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-sans text-sm">{l.title}</p>
                    <p className="font-sans text-xs text-muted">
                      {[l.color, l.size && `maat ${l.size}`, `${l.qty}×`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <p className="font-sans text-sm">{formatEuro(l.priceCents * l.qty)}</p>
                </li>
              ))}
            </ul>
            <dl className="mt-4 space-y-1.5 border-t border-line pt-4 font-sans text-sm">
              <div className="flex justify-between"><dt className="text-muted">Subtotaal</dt><dd>{formatEuro(cart.subtotalCents)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Verzending</dt><dd>{shippingCents === 0 ? "Gratis" : formatEuro(shippingCents)}</dd></div>
              <div className="flex justify-between border-t border-line pt-2 font-medium"><dt>Totaal</dt><dd className="font-display text-lg">{formatEuro(totalCents)}</dd></div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
