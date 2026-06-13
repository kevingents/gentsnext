"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useCart } from "@/components/cart/cart-context";
import { DeliveryOptions } from "@/components/cart/delivery-options";
import { FooterPayments } from "@/components/footer-payments";
import { track } from "@/lib/track-client";
import { formatEuro } from "@/lib/pricing";

type Field = {
  name: string;
  label: string;
  col: 1 | 2;
  type?: string;
  optional?: boolean;
  autoComplete?: string;
  inputMode?: "text" | "numeric" | "tel" | "email";
  placeholder?: string;
};

// Volgorde: postcode + huisnummer eerst → straat/plaats vullen automatisch.
const FIELDS: Field[] = [
  { name: "firstName", label: "Voornaam", col: 1, autoComplete: "given-name" },
  { name: "lastName", label: "Achternaam", col: 1, autoComplete: "family-name" },
  { name: "email", label: "E-mailadres", col: 2, type: "email", autoComplete: "email", inputMode: "email" },
  { name: "phone", label: "Telefoon (optioneel)", col: 2, type: "tel", optional: true, autoComplete: "tel", inputMode: "tel" },
  { name: "postalCode", label: "Postcode", col: 1, autoComplete: "postal-code", placeholder: "1234 AB" },
  { name: "houseNumber", label: "Huisnummer", col: 1, autoComplete: "address-line2", inputMode: "numeric", placeholder: "12" },
  { name: "street", label: "Straat", col: 1, autoComplete: "address-line1" },
  { name: "city", label: "Plaats", col: 1, autoComplete: "address-level2" },
];

const POSTCODE_RE = /^[1-9][0-9]{3}\s?[a-zA-Z]{2}$/;
const HOUSENR_RE = /^[0-9]+[a-zA-Z0-9 -]*$/;

function Steps() {
  const steps = ["Winkelwagen", "Gegevens", "Betalen"];
  return (
    <ol className="mt-3 flex items-center gap-2 font-sans text-xs text-muted">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={`flex h-5 w-5 items-center justify-center rounded-full ${i === 1 ? "bg-ink text-canvas" : "border border-line"}`}>{i + 1}</span>
          <span className={i === 1 ? "font-medium text-ink" : ""}>{s}</span>
          {i < steps.length - 1 ? <span aria-hidden className="mx-1 text-line">—</span> : null}
        </li>
      ))}
    </ol>
  );
}

export default function AfrekenenPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-page px-gutter py-12"><h1 className="text-display-md">Afrekenen</h1></div>}>
      <CheckoutForm />
    </Suspense>
  );
}

function CheckoutForm() {
  const cart = useCart();
  const params = useSearchParams();
  const canceled = params.get("geannuleerd") === "1";

  const [form, setForm] = useState<Record<string, string>>({});
  const [agree, setAgree] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [delivery, setDelivery] = useState<"standard" | "express">("standard");
  const [expressSurcharge, setExpressSurcharge] = useState(0);
  const [voucher, setVoucher] = useState<{ code: string; discountCents: number; label: string } | null>(null);
  const [voucherInput, setVoucherInput] = useState("");
  const [voucherErr, setVoucherErr] = useState("");

  // Adres-autofill: postcode + huisnummer → straat + plaats.
  useEffect(() => {
    const pc = (form.postalCode || "").replace(/\s/g, "").toUpperCase();
    const nr = (form.houseNumber || "").trim();
    if (!/^[1-9][0-9]{3}[A-Z]{2}$/.test(pc) || !nr) return;
    let active = true;
    fetch(`/api/postcode?postcode=${pc}&number=${encodeURIComponent(nr)}`)
      .then((r) => r.json())
      .then((d) => {
        if (active && d.street) setForm((p) => ({ ...p, street: d.street, city: d.city || p.city }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [form.postalCode, form.houseNumber]);

  const baseShipping = cart.subtotalCents >= 7500 ? 0 : cart.subtotalCents > 0 ? 495 : 0;
  const surcharge = delivery === "express" ? expressSurcharge : 0;
  const shippingCents = baseShipping + surcharge;
  const discountCents = voucher?.discountCents ?? 0;
  const totalCents = Math.max(0, cart.subtotalCents - discountCents) + shippingCents;

  async function applyVoucher() {
    setVoucherErr("");
    if (!voucherInput.trim()) return;
    try {
      const r = await fetch("/api/voucher/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: voucherInput, subtotalCents: cart.subtotalCents }),
      });
      const d = await r.json();
      if (d.valid) {
        setVoucher({ code: d.code, discountCents: d.discountCents, label: d.label });
        setVoucherErr("");
      } else {
        setVoucher(null);
        setVoucherErr(d.error || "Ongeldige code.");
      }
    } catch {
      setVoucherErr("Kon de code niet controleren.");
    }
  }

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
    // Lichte validatie (datakwaliteit → minder mislukte bezorgingen).
    if (!POSTCODE_RE.test(form.postalCode || "")) {
      setError("Vul een geldige postcode in (bijv. 1234 AB).");
      return;
    }
    if (!HOUSENR_RE.test((form.houseNumber || "").trim())) {
      setError("Vul een geldig huisnummer in (begint met een cijfer).");
      return;
    }
    if (!agree) {
      setError("Accepteer de algemene voorwaarden om te bestellen.");
      return;
    }
    setBusy(true);
    track("checkout_start", { valueCents: totalCents, props: { items: cart.lines.length } });
    // Niet-voorgevinkte nieuwsbrief-opt-in (AVG): alleen bij expliciete keuze.
    if (newsletter && form.email) {
      fetch("/api/newsletter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.email }) }).catch(() => {});
    }
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: form,
          deliveryMethod: delivery,
          voucherCode: voucher?.code || "",
          items: cart.lines.map((l) => ({ sku: l.sku, qty: l.qty, groupId: l.groupId, roleLabel: l.roleLabel })),
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
        setNotice(`${data.message} Je bestelnummer is ${data.orderNumber}. We nemen contact op zodra betalen mogelijk is.`);
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
          <Link href="/" className="btn-ghost mt-8">Terug naar home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <h1 className="text-display-md">Afrekenen</h1>
      <Steps />

      {canceled ? (
        <div className="mt-6 rounded-card border border-line bg-surface px-4 py-3 font-sans text-sm text-ink-soft">
          <span className="font-medium text-ink">Je betaling is geannuleerd.</span> Er is niets afgeschreven en je winkelwagen staat nog klaar — je kunt het zo opnieuw proberen.
        </div>
      ) : null}

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Formulier */}
        <form onSubmit={submit} noValidate>
          <p className="label-brand">Contact & bezorgadres</p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            {FIELDS.map((f) => (
              <label key={f.name} className={f.col === 2 ? "col-span-2 block" : "block"}>
                <span className="font-sans text-sm text-ink">{f.label}</span>
                <input
                  type={f.type ?? "text"}
                  inputMode={f.inputMode}
                  autoComplete={f.autoComplete}
                  placeholder={f.placeholder}
                  value={form[f.name] || ""}
                  onChange={(e) => setForm((p) => ({ ...p, [f.name]: e.target.value }))}
                  required={!f.optional}
                  className="mt-1.5 w-full border border-line bg-canvas px-4 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
                />
              </label>
            ))}
            <label className="col-span-2 block">
              <span className="font-sans text-sm text-ink">Land</span>
              <input value="Nederland" readOnly className="mt-1.5 w-full border border-line bg-surface px-4 py-2.5 font-sans text-sm text-muted" />
            </label>
          </div>

          <label className="mt-6 flex items-start gap-2 font-sans text-sm">
            <input type="checkbox" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} className="mt-0.5 h-4 w-4 accent-ink" />
            <span className="text-ink-soft">Houd me per e-mail op de hoogte van nieuwe collecties en aanbiedingen. (Je kunt je altijd weer uitschrijven.)</span>
          </label>

          <label className="mt-3 flex items-start gap-2 font-sans text-sm">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 accent-ink" />
            <span className="text-ink-soft">
              Ik ga akkoord met de <Link href="/pages/algemene-voorwaarden" className="text-ink underline">algemene voorwaarden</Link> en het{" "}
              <Link href="/pages/retourneren" className="text-ink underline">herroepingsrecht</Link> (14 dagen bedenktijd).
            </span>
          </label>

          {error ? <p role="alert" className="mt-4 font-sans text-sm text-danger">{error}</p> : null}

          <button type="submit" disabled={busy} className="btn-primary mt-6 w-full">
            {busy ? "Bezig…" : `Veilig betalen — ${formatEuro(totalCents)}`}
          </button>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <FooterPayments />
            <span className="font-sans text-xs text-muted">Je rondt de betaling af via iDEAL/Mollie. Totaal incl. btw · gratis retour binnen 14 dagen.</span>
          </div>
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
                    <p className="font-sans text-xs text-muted">{[l.color, l.size && `maat ${l.size}`, `${l.qty}×`].filter(Boolean).join(" · ")}</p>
                  </div>
                  <p className="font-sans text-sm">{formatEuro(l.priceCents * l.qty)}</p>
                </li>
              ))}
            </ul>
            <div className="mt-4 border-t border-line pt-4">
              <DeliveryOptions
                items={cart.lines.map((l) => ({ sku: l.sku, qty: l.qty }))}
                value={delivery}
                onChange={(m, s) => {
                  setDelivery(m);
                  setExpressSurcharge(m === "express" ? s : expressSurcharge || s);
                }}
              />
            </div>
            <div className="mt-4 border-t border-line pt-4">
              {voucher ? (
                <div className="flex items-center justify-between font-sans text-sm">
                  <span className="text-success">Code {voucher.code} — {voucher.label}</span>
                  <button type="button" onClick={() => { setVoucher(null); setVoucherInput(""); }} className="text-muted underline">verwijder</button>
                </div>
              ) : (
                <div>
                  <div className="flex gap-2">
                    <input value={voucherInput} onChange={(e) => setVoucherInput(e.target.value)} placeholder="Kortingscode" className="w-full border border-line bg-canvas px-3 py-2 font-sans text-sm uppercase focus:border-ink focus:outline-none" />
                    <button type="button" onClick={applyVoucher} className="btn-ghost !px-4 !py-2 whitespace-nowrap">Toepassen</button>
                  </div>
                  {voucherErr ? <p className="mt-1 font-sans text-xs text-danger">{voucherErr}</p> : null}
                </div>
              )}
            </div>
            <dl className="mt-4 space-y-1.5 border-t border-line pt-4 font-sans text-sm">
              <div className="flex justify-between"><dt className="text-muted">Subtotaal</dt><dd>{formatEuro(cart.subtotalCents)}</dd></div>
              {discountCents > 0 ? (<div className="flex justify-between text-success"><dt>Korting ({voucher?.code})</dt><dd>− {formatEuro(discountCents)}</dd></div>) : null}
              <div className="flex justify-between"><dt className="text-muted">Verzending</dt><dd>{baseShipping === 0 ? "Gratis" : formatEuro(baseShipping)}</dd></div>
              {surcharge > 0 ? (<div className="flex justify-between"><dt className="text-muted">Snellere levering</dt><dd>+ {formatEuro(surcharge)}</dd></div>) : null}
              <div className="flex justify-between border-t border-line pt-2 font-medium"><dt>Totaal</dt><dd className="font-display text-lg">{formatEuro(totalCents)}</dd></div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
