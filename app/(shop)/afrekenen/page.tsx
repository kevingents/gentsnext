"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useCart } from "@/components/cart/cart-context";
import { DeliveryOptions } from "@/components/cart/delivery-options";
import { FooterPayments } from "@/components/footer-payments";
import { BrandedState } from "@/components/brand-state";
import { track } from "@/lib/track-client";
import { formatEuro, tieredDiscountCents, type TieredDiscountCfg } from "@/lib/pricing";

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
  { name: "email", label: "E-mailadres", col: 1, type: "email", autoComplete: "email", inputMode: "email" },
  { name: "phone", label: "Telefoon (optioneel)", col: 1, type: "tel", optional: true, autoComplete: "tel", inputMode: "tel" },
  { name: "postalCode", label: "Postcode", col: 1, autoComplete: "postal-code", placeholder: "1234 AB" },
  { name: "houseNumber", label: "Huisnummer", col: 1, autoComplete: "address-line2", inputMode: "numeric", placeholder: "12" },
  { name: "street", label: "Straat", col: 1, autoComplete: "address-line1" },
  { name: "city", label: "Plaats", col: 1, autoComplete: "address-level2" },
];

const POSTCODE_RE = /^[1-9][0-9]{3}\s?[a-zA-Z]{2}$/;
const HOUSENR_RE = /^[0-9]+[a-zA-Z0-9 -]*$/;

function Steps({ step }: { step: "gegevens" | "betalen" }) {
  const steps: { label: string; done?: boolean; active?: boolean }[] = [
    { label: "Winkelwagen", done: true },
    { label: "Gegevens & bezorging", done: step === "betalen", active: step === "gegevens" },
    { label: "Betalen", active: step === "betalen" },
    { label: "Bevestiging" },
  ];
  return (
    <ol className="mt-3 flex items-center">
      {steps.map((s, i) => (
        <li key={s.label} className={`flex items-center ${i < steps.length - 1 ? "flex-1" : ""}`}>
          <span className="flex shrink-0 items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full font-sans text-xs ${s.done ? "bg-ink text-canvas" : s.active ? "border-2 border-ink font-medium text-ink" : "border border-line text-muted"}`}>
              {s.done ? (
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12l5 5 9-9" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : (
                i + 1
              )}
            </span>
            <span className={`hidden font-sans text-xs sm:inline ${s.active ? "font-medium text-ink" : s.done ? "text-ink-soft" : "text-muted"}`}>{s.label}</span>
          </span>
          {i < steps.length - 1 ? <span aria-hidden className={`mx-2 h-px flex-1 ${s.done ? "bg-ink" : "bg-line"}`} /> : null}
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
  const [business, setBusiness] = useState(false);
  const [agree, setAgree] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // SKU's die de voorraad-gate weigerde — markeren + in één klik verwijderbaar.
  const [unavailableSkus, setUnavailableSkus] = useState<string[]>([]);
  // Stappen-checkout: gegevens → betalen (één sectie per scherm, past op elke resolutie).
  const [step, setStep] = useState<"gegevens" | "betalen">("gegevens");

  // Betaalmethode vooraf kiezen (i.p.v. Mollie's gehoste keuzescherm).
  type PayMethod = { id: string; description: string; image: string };
  const [methods, setMethods] = useState<PayMethod[]>([]);
  const [payMethod, setPayMethod] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/payment-methods")
      .then((r) => r.json())
      .then((d) => { if (active) { const ms: PayMethod[] = d.methods || []; setMethods(ms); setPayMethod((cur) => cur || ms[0]?.id || ""); } })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const [delivery, setDelivery] = useState<"standard" | "express">("standard");
  const [expressSurcharge, setExpressSurcharge] = useState(0);
  // Afhalen in winkel (click & collect): gratis, geen adres nodig.
  const [pickupMode, setPickupMode] = useState(false);
  const [pickupStore, setPickupStore] = useState("");
  const [stores, setStores] = useState<{ name: string; city: string }[]>([]);
  useEffect(() => {
    let active = true;
    fetch("/api/stores")
      .then((r) => r.json())
      .then((d) => { if (active) { const s = d.stores || []; setStores(s); setPickupStore((cur) => cur || s[0]?.name || ""); } })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  // Voorraad per winkel voor de afhaal-keuze: welke winkel heeft álles op voorraad?
  type StoreAvail = { name: string; city: string; allOk: boolean; okCount: number; total: number; missingSkus: string[] };
  const [pickupAvail, setPickupAvail] = useState<Record<string, StoreAvail>>({});
  const [pickupAvailLoading, setPickupAvailLoading] = useState(false);
  const pickupSig = cart.lines.map((l) => `${l.sku}:${l.qty}`).join("|");
  useEffect(() => {
    if (!pickupMode || cart.lines.length === 0) { setPickupAvail({}); return; }
    let active = true;
    setPickupAvailLoading(true);
    fetch("/api/pickup-availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: cart.lines.map((l) => ({ sku: l.sku, qty: l.qty })) }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        const map: Record<string, StoreAvail> = {};
        for (const s of (d.stores || []) as StoreAvail[]) map[s.name] = s;
        setPickupAvail(map);
      })
      .catch(() => {})
      .finally(() => { if (active) setPickupAvailLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupMode, pickupSig]);
  const storesByAvail = useMemo(() => {
    const rank = (n: string) => {
      const a = pickupAvail[n];
      if (!a || a.total === 0) return -1;
      return a.allOk ? 2 : a.okCount > 0 ? 1 : 0;
    };
    return [...stores].sort((x, y) => {
      const d = rank(y.name) - rank(x.name);
      return d !== 0 ? d : x.name.localeCompare(y.name, "nl");
    });
  }, [stores, pickupAvail]);
  // Toon alleen filialen waar (een deel van) de bestelling op voorraad ligt — verberg
  // de 0-op-voorraad-winkels. Nog geen data → alles tonen (nooit terugvallen op leeg).
  const pickupStores = useMemo(() => {
    const withStock = storesByAvail.filter((s) => {
      const a = pickupAvail[s.name];
      return !a || a.total === 0 || a.okCount > 0;
    });
    return withStock.length ? withStock : storesByAvail;
  }, [storesByAvail, pickupAvail]);
  // Viel de gekozen winkel weg uit de lijst (geen voorraad) → schakel naar de beste.
  useEffect(() => {
    if (!pickupMode || !pickupStores.length) return;
    if (!pickupStores.some((s) => s.name === pickupStore)) setPickupStore(pickupStores[0].name);
  }, [pickupMode, pickupStores, pickupStore]);
  const [voucher, setVoucher] = useState<{ code: string; discountCents: number; label: string } | null>(null);
  const [giftcard, setGiftcard] = useState<{ code: string; balanceCents: number } | null>(null);
  const [tiered, setTiered] = useState<TieredDiscountCfg | null>(null);
  // Verzend-drempels uit de instelbare settings (fallback = de oude defaults) zodat de
  // getoonde verzendkosten meelopen als een beheerder ze wijzigt — de server rekent er
  // toch mee (createOrder), dus dit houdt "getoond = afgeschreven" in sync.
  const [freeShipCents, setFreeShipCents] = useState(7500);
  const [shipCents, setShipCents] = useState(495);
  useEffect(() => {
    let active = true;
    fetch("/api/promo").then((r) => r.json()).then((d) => {
      if (!active) return;
      setTiered(d?.tieredDiscount || null);
      if (Number.isFinite(d?.freeShippingCents)) setFreeShipCents(d.freeShippingCents);
      if (Number.isFinite(d?.shippingCents)) setShipCents(d.shippingCents);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  // Eén veld voor kortingscode óf cadeaubon — de server bepaalt welke het is.
  const [codeInput, setCodeInput] = useState("");
  const [codeErr, setCodeErr] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);

  type PrefillAddr = { id: string; label: string; firstName: string; lastName: string; street: string; houseNumber: string; postalCode: string; city: string };
  type Prefill = { loggedIn: boolean; email?: string; firstName?: string; lastName?: string; phone?: string; defaultAddressId?: string | null; addresses?: PrefillAddr[] };
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [addrId, setAddrId] = useState("");

  // Checkout-prefill: ingelogde klant → gegevens + opgeslagen adres vast invullen
  // (alleen lege velden; we overschrijven niets wat de bezoeker al typte).
  useEffect(() => {
    let active = true;
    fetch("/api/account/prefill")
      .then((r) => r.json())
      .then((d: Prefill) => {
        if (!active) return;
        setPrefill(d || { loggedIn: false });
        if (!d?.loggedIn) return;
        const a = (d.addresses || []).find((x) => x.id === d.defaultAddressId) || (d.addresses || [])[0];
        setAddrId(a?.id || "");
        setForm((p) => {
          const next = { ...p };
          const fill = (k: string, v?: string) => { if (!next[k] && v) next[k] = v; };
          fill("firstName", a?.firstName || d.firstName);
          fill("lastName", a?.lastName || d.lastName);
          fill("email", d.email);
          fill("phone", d.phone);
          if (a) { fill("postalCode", a.postalCode); fill("houseNumber", a.houseNumber); fill("street", a.street); fill("city", a.city); }
          return next;
        });
      })
      .catch(() => { if (active) setPrefill({ loggedIn: false }); });
    return () => { active = false; };
  }, []);

  function chooseAddress(id: string) {
    setAddrId(id);
    const a = prefill?.addresses?.find((x) => x.id === id);
    if (!a) return;
    setForm((p) => ({ ...p, firstName: a.firstName || p.firstName, lastName: a.lastName || p.lastName, postalCode: a.postalCode, houseNumber: a.houseNumber, street: a.street, city: a.city }));
  }

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

  const baseShipping = pickupMode ? 0 : cart.subtotalCents >= freeShipCents ? 0 : cart.subtotalCents > 0 ? shipCents : 0;
  const surcharge = pickupMode ? 0 : delivery === "express" ? expressSurcharge : 0;
  const shippingCents = baseShipping + surcharge;
  const itemCount = cart.lines.reduce((n, l) => n + l.qty, 0);
  const tieredCents = tieredDiscountCents(itemCount, cart.subtotalCents, tiered);
  const voucherCents = voucher?.discountCents ?? 0;
  const discountCents = Math.min(cart.subtotalCents, voucherCents + tieredCents);
  const totalCents = Math.max(0, cart.subtotalCents - discountCents) + shippingCents;
  // Cadeaubon dekt (een deel van) het hele bedrag incl. verzending.
  const giftcardCents = giftcard ? Math.min(giftcard.balanceCents, totalCents) : 0;
  const payableCents = Math.max(0, totalCents - giftcardCents);

  const unavailableSet = new Set(unavailableSkus.map((s) => s.toLowerCase()));
  function removeLine(id: string) {
    cart.remove(id);
    setError("");
    setUnavailableSkus([]);
  }
  function removeUnavailable() {
    for (const l of cart.lines) if (unavailableSet.has(l.sku.toLowerCase())) cart.remove(l.id);
    setError("");
    setUnavailableSkus([]);
  }

  async function applyCode() {
    setCodeErr("");
    const code = codeInput.trim();
    if (!code) return;
    setCodeBusy(true);
    try {
      const r = await fetch("/api/redeem-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, subtotalCents: cart.subtotalCents, amountCents: totalCents }),
      });
      const d = await r.json();
      if (d.type === "giftcard") {
        setGiftcard({ code: d.code, balanceCents: d.balanceCents });
        setCodeInput("");
      } else if (d.type === "voucher") {
        setVoucher({ code: d.code, discountCents: d.discountCents, label: d.label });
        setCodeInput("");
      } else {
        setCodeErr(d.error || "Onbekende code.");
      }
    } catch {
      setCodeErr("Kon de code niet controleren.");
    } finally {
      setCodeBusy(false);
    }
  }

  if (cart.lines.length === 0 && !notice) {
    return (
      <BrandedState eyebrow="Afrekenen" title="Je winkelwagen is leeg" intro="Leg eerst iets in je winkelwagen — dan reken je hier veilig af.">
        <Link href="/collections/pakken" className="btn-primary">Begin met shoppen</Link>
      </BrandedState>
    );
  }

  // Stap 1 → 2: valideer gegevens & bezorging vóór we naar betalen gaan.
  function goToPayment() {
    setError("");
    if (pickupMode) {
      if (!pickupStore) { setError("Kies een winkel om af te halen."); return; }
    } else {
      if (!POSTCODE_RE.test(form.postalCode || "")) { setError("Vul een geldige postcode in (bijv. 1234 AB)."); return; }
      if (!HOUSENR_RE.test((form.houseNumber || "").trim())) { setError("Vul een geldig huisnummer in (begint met een cijfer)."); return; }
    }
    if (!(form.firstName || "").trim() || !(form.lastName || "").trim() || !/.+@.+\..+/.test(form.email || "")) {
      setError("Vul je naam en een geldig e-mailadres in."); return;
    }
    if (business && !(form.companyName || "").trim()) { setError("Vul de bedrijfsnaam in voor een zakelijke bestelling."); return; }
    setError("");
    setStep("betalen");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setUnavailableSkus([]);
    if (pickupMode) {
      if (!pickupStore) { setError("Kies een winkel om af te halen."); return; }
    } else {
      // Lichte validatie (datakwaliteit → minder mislukte bezorgingen).
      if (!POSTCODE_RE.test(form.postalCode || "")) {
        setError("Vul een geldige postcode in (bijv. 1234 AB).");
        return;
      }
      if (!HOUSENR_RE.test((form.houseNumber || "").trim())) {
        setError("Vul een geldig huisnummer in (begint met een cijfer).");
        return;
      }
    }
    if (business && !(form.companyName || "").trim()) {
      setError("Vul de bedrijfsnaam in voor een zakelijke bestelling.");
      return;
    }
    if (!agree) {
      setError("Accepteer de algemene voorwaarden om te bestellen.");
      return;
    }
    setBusy(true);
    track("checkout_start", { valueCents: payableCents, props: { items: cart.lines.length } });
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
          deliveryMethod: pickupMode ? "pickup" : delivery,
          pickupStore: pickupMode ? pickupStore : "",
          method: payMethod,
          voucherCode: voucher?.code || "",
          giftcardCode: giftcard?.code || "",
          items: cart.lines.map((l) => ({ sku: l.sku, qty: l.qty, groupId: l.groupId, roleLabel: l.roleLabel })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Er ging iets mis.");
        setUnavailableSkus(Array.isArray(data.unavailableSkus) ? data.unavailableSkus.map(String) : []);
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
      <BrandedState eyebrow="Bedankt" title="Je bestelling is genoteerd" intro={notice}>
        <Link href="/" className="btn-ghost">Terug naar home</Link>
      </BrandedState>
    );
  }

  return (
    <div className="mx-auto max-w-page px-gutter py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="text-2xl font-display font-light sm:text-3xl">Afrekenen</h1>
        <div className="min-w-[16rem] flex-1"><Steps step={step} /></div>
      </div>

      {canceled ? (
        <div className="mt-6 rounded-card border border-line bg-surface px-4 py-3 font-sans text-sm text-ink-soft">
          <span className="font-medium text-ink">Je betaling is geannuleerd.</span> Er is niets afgeschreven en je winkelwagen staat nog klaar — je kunt het zo opnieuw proberen.
        </div>
      ) : null}

      {/* Al klant? — inloggen vult gegevens & adres vast in. Gast blijft mogelijk. */}
      {step === "gegevens" && prefill && !prefill.loggedIn ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-surface px-3 py-2 font-sans text-xs">
          <span className="text-ink-soft"><span className="font-medium text-ink">Al klant?</span> Log in — we vullen je gegevens vast in. Als gast bestellen kan ook.</span>
          <Link href="/account/login?next=/afrekenen" className="btn-ghost !px-3 !py-1 whitespace-nowrap">Inloggen</Link>
        </div>
      ) : null}
      {step === "gegevens" && prefill?.loggedIn ? (
        <div className="mt-6 rounded-card border border-line bg-surface px-4 py-3 font-sans text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-ink-soft"><span className="font-medium text-ink">Welkom terug.</span> We hebben je gegevens vast ingevuld{prefill.email ? ` (${prefill.email})` : ""}.</span>
            {prefill.addresses && prefill.addresses.length > 1 ? (
              <label className="flex items-center gap-2">
                <span className="text-xs text-muted">Bezorgadres</span>
                <select value={addrId} onChange={(e) => chooseAddress(e.target.value)} className="border border-line bg-canvas px-2 py-1 text-sm focus:border-ink focus:outline-none">
                  {prefill.addresses.map((a) => <option key={a.id} value={a.id}>{a.label} — {a.street} {a.houseNumber}, {a.city}</option>)}
                </select>
              </label>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-6 lg:gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Formulier */}
        <form onSubmit={submit} noValidate>
          {step === "gegevens" ? (
          <>
          {/* Particulier / Zakelijk */}
          <div className="inline-flex rounded-card border border-line p-0.5">
            {([["Particulier", false], ["Zakelijk", true]] as const).map(([label, val]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setBusiness(val);
                  if (!val) setForm((p) => ({ ...p, companyName: "", vatNumber: "" }));
                }}
                className={`px-4 py-1.5 font-sans text-sm transition-colors ${business === val ? "bg-ink text-canvas" : "text-ink-soft hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {business ? (
            <>
              <p className="label-brand mt-4">Bedrijfsgegevens</p>
              <div className="mt-2 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
                <label className="col-span-2 block">
                  <span className="font-sans text-sm text-ink">Bedrijfsnaam</span>
                  <input
                    value={form.companyName || ""}
                    onChange={(e) => setForm((p) => ({ ...p, companyName: e.target.value }))}
                    autoComplete="organization"
                    required
                    className="mt-1 w-full border border-line bg-canvas px-4 py-2 font-sans text-sm focus:border-ink focus:outline-none"
                  />
                </label>
                <label className="col-span-2 block">
                  <span className="font-sans text-sm text-ink">
                    BTW-nummer <span className="text-muted">(optioneel)</span>
                  </span>
                  <input
                    value={form.vatNumber || ""}
                    onChange={(e) => setForm((p) => ({ ...p, vatNumber: e.target.value.toUpperCase() }))}
                    autoComplete="off"
                    placeholder="NL000000000B00"
                    className="mt-1 w-full border border-line bg-canvas px-4 py-2 font-sans text-sm focus:border-ink focus:outline-none"
                  />
                  <span className="mt-1 block font-sans text-xs text-muted">Vermeld je BTW-nummer voor een correcte zakelijke factuur.</span>
                </label>
              </div>
            </>
          ) : null}

          {/* Bezorgen of afhalen in winkel (click & collect) */}
          <p className="label-brand mt-4">Ontvangen</p>
          <div className="mt-3 inline-flex rounded-card border border-line p-0.5">
            {([["Bezorgen", false], ["Afhalen in winkel", true]] as const).map(([label, val]) => (
              <button
                key={label}
                type="button"
                onClick={() => setPickupMode(val)}
                className={`px-4 py-1.5 font-sans text-sm transition-colors ${pickupMode === val ? "bg-ink text-canvas" : "text-ink-soft hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {pickupMode ? (
            <label className="mt-4 block">
              <span className="font-sans text-sm text-ink">Kies een winkel</span>
              <select
                value={pickupStore}
                onChange={(e) => setPickupStore(e.target.value)}
                className="mt-1 w-full border border-line bg-canvas px-4 py-2 font-sans text-sm focus:border-ink focus:outline-none"
              >
                {pickupStores.map((s) => {
                  const a = pickupAvail[s.name];
                  const suffix = !a || a.total === 0 ? "" : a.allOk ? " — alles op voorraad" : ` — ${a.okCount}/${a.total} op voorraad`;
                  return <option key={s.name} value={s.name}>{s.name}{suffix}</option>;
                })}
              </select>
              {(() => {
                const sel = pickupAvail[pickupStore];
                if (pickupAvailLoading && !sel) return <span className="mt-1 block font-sans text-xs text-muted">Voorraad in winkels controleren…</span>;
                if (!sel || sel.total === 0) return <span className="mt-1 block font-sans text-xs text-muted">Gratis afhalen — je krijgt bericht zodra je bestelling klaarligt.</span>;
                if (sel.allOk) return <span className="mt-1 block font-sans text-xs text-success">Alles ligt op voorraad in {pickupStore} — gratis afhalen, je krijgt bericht zodra het klaarligt.</span>;
                const missingTitles = sel.missingSkus
                  .map((sku) => cart.lines.find((l) => l.sku.toLowerCase() === sku.toLowerCase())?.title)
                  .filter(Boolean) as string[];
                const best = storesByAvail.find((s) => pickupAvail[s.name]?.allOk);
                return (
                  <span className="mt-1 block font-sans text-xs text-ink-soft">
                    <span className="text-danger">Niet alles ligt op voorraad in {pickupStore}</span>
                    {missingTitles.length ? <> (mist: {missingTitles.join(", ")})</> : null}.{" "}
                    {best && best.name !== pickupStore ? (
                      <button type="button" onClick={() => setPickupStore(best.name)} className="font-medium text-ink underline">
                        Kies {best.name} — alles op voorraad
                      </button>
                    ) : (
                      "Kies een andere winkel of kies bezorgen."
                    )}
                  </span>
                );
              })()}
            </label>
          ) : null}

          <p className="label-brand mt-4">{pickupMode ? "Contactgegevens" : "Contact & bezorgadres"}</p>
          <div className="mt-2 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
            {FIELDS.filter((f) => !pickupMode || !["postalCode", "houseNumber", "street", "city"].includes(f.name)).map((f) => (
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
                  className="mt-1 w-full border border-line bg-canvas px-4 py-2 font-sans text-sm focus:border-ink focus:outline-none"
                />
              </label>
            ))}
            {!pickupMode ? (
              <p className="col-span-full font-sans text-xs text-muted">Levering binnen Nederland.</p>
            ) : null}
          </div>

          {error ? (
            <div role="alert" className="mt-4 rounded-card border border-danger/40 bg-danger/5 px-4 py-3 font-sans text-sm text-danger">{error}</div>
          ) : null}
          <button type="button" onClick={goToPayment} className="btn-primary mt-5 w-full">
            Naar betalen
          </button>
          </>
          ) : (
          <>
          <button type="button" onClick={() => { setStep("gegevens"); setError(""); }} className="mb-4 inline-flex items-center gap-1 font-sans text-sm text-ink-soft hover:text-ink">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Terug naar gegevens
          </button>

          {/* Betaalmethode vooraf — geen tussenstop meer op Mollie's keuzescherm. */}
          {payableCents > 0 && methods.length ? (
            <>
              <p className="label-brand mt-4">Betaalmethode</p>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {methods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPayMethod(m.id)}
                    aria-pressed={payMethod === m.id}
                    className={`flex items-center gap-2.5 rounded-card border px-3 py-2.5 text-left font-sans text-sm transition-colors ${payMethod === m.id ? "border-ink bg-surface" : "border-line hover:border-ink"}`}
                  >
                    {m.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.image} alt="" className="h-6 w-6 shrink-0" />
                    ) : null}
                    <span className="truncate">{m.description}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <label className="mt-3 flex items-start gap-2 font-sans text-sm">
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

          {error ? (
            <div role="alert" className="mt-4 rounded-card border border-danger/40 bg-danger/5 px-4 py-3 font-sans text-sm">
              <p className="text-danger">{error}</p>
              {unavailableSkus.length ? (
                <button type="button" onClick={removeUnavailable} className="btn-ghost mt-3 !px-4 !py-2">
                  Verwijder niet-leverbare artikelen
                </button>
              ) : null}
            </div>
          ) : null}

          <button type="submit" disabled={busy} className="btn-primary mt-4 w-full">
            {busy
              ? "Bezig…"
              : payableCents === 0
                ? "Bestelling afronden — volledig met cadeaubon"
                : `Veilig betalen — ${formatEuro(payableCents)}`}
          </button>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <FooterPayments />
            <span className="font-sans text-xs text-muted">
              {payableCents === 0
                ? "Je cadeaubon dekt het volledige bedrag — geen betaling nodig."
                : `Je rondt af via ${methods.find((m) => m.id === payMethod)?.description || "Mollie"} · totaal incl. btw · gratis retour binnen 14 dagen.`}
            </span>
          </div>
          </>
          )}
        </form>

        {/* Overzicht */}
        <aside className="lg:sticky lg:top-20 lg:h-fit">
          <div className="border border-line p-4">
            <p className="label-brand mb-3">Je bestelling</p>
            <ul className="hidden space-y-3 lg:block">
              {cart.lines.map((l) => {
                const unavailable = unavailableSet.has(l.sku.toLowerCase());
                return (
                  <li key={l.id} className={`flex gap-3 ${unavailable ? "-mx-2 rounded-card border border-danger/30 bg-danger/5 px-2 py-1.5" : ""}`}>
                    <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-card bg-surface">
                      {l.imageUrl ? <Image src={l.imageUrl} alt={l.title} fill sizes="48px" className="object-cover" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-sans text-sm">{l.title}</p>
                      <p className="font-sans text-xs text-muted">{[l.color, l.size && `maat ${l.size}`, `${l.qty}×`].filter(Boolean).join(" · ")}</p>
                      {unavailable ? <p className="mt-0.5 font-sans text-xs font-medium text-danger">Niet meer leverbaar</p> : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end justify-between">
                      <p className="font-sans text-sm">{formatEuro(l.priceCents * l.qty)}</p>
                      <button
                        type="button"
                        onClick={() => removeLine(l.id)}
                        aria-label={`Verwijder ${l.title}`}
                        className="font-sans text-xs text-muted underline underline-offset-2 hover:text-ink"
                      >
                        Verwijder
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="font-sans text-sm text-ink-soft lg:hidden">{cart.lines.reduce((n, l) => n + l.qty, 0)} artikel(en) in je winkelwagen.</p>
            <div className="mt-4 border-t border-line pt-4">
              {pickupMode ? (
                <div className="font-sans text-sm">
                  <p className="font-medium text-ink">Afhalen in winkel</p>
                  <p className="mt-1 text-ink-soft">Gratis · {pickupStore || "kies een winkel"} — je krijgt bericht zodra het klaarligt.</p>
                </div>
              ) : (
                <DeliveryOptions
                  items={cart.lines.map((l) => ({ sku: l.sku, qty: l.qty }))}
                  value={delivery}
                  onChange={(m, s) => {
                    setDelivery(m);
                    setExpressSurcharge(m === "express" ? s : expressSurcharge || s);
                  }}
                />
              )}
            </div>
            <div className="mt-4 border-t border-line pt-4">
              {/* Toegepaste codes */}
              {voucher ? (
                <div className="flex items-center justify-between font-sans text-sm">
                  <span className="text-success">Kortingscode {voucher.code} — {voucher.label}</span>
                  <button type="button" onClick={() => setVoucher(null)} className="text-muted underline">verwijder</button>
                </div>
              ) : null}
              {giftcard ? (
                <div className={`flex items-center justify-between font-sans text-sm ${voucher ? "mt-2" : ""}`}>
                  <span className="text-success">Cadeaubon {giftcard.code} — saldo {formatEuro(giftcard.balanceCents)}</span>
                  <button type="button" onClick={() => setGiftcard(null)} className="text-muted underline">verwijder</button>
                </div>
              ) : null}
              {/* Eén veld: kortingscode óf cadeaubon */}
              <div className={voucher || giftcard ? "mt-3" : ""}>
                <div className="flex gap-2">
                  <input
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyCode();
                      }
                    }}
                    placeholder="Kortingscode of cadeaubon"
                    aria-label="Kortingscode of cadeaubon"
                    className="w-full border border-line bg-canvas px-3 py-2 font-sans text-sm uppercase focus:border-ink focus:outline-none"
                  />
                  <button type="button" onClick={applyCode} disabled={codeBusy} className="btn-ghost !px-4 !py-2 whitespace-nowrap">
                    {codeBusy ? "…" : "Toepassen"}
                  </button>
                </div>
                {codeErr ? <p className="mt-1 font-sans text-xs text-danger">{codeErr}</p> : null}
              </div>
            </div>
            <dl className="mt-4 space-y-1.5 border-t border-line pt-4 font-sans text-sm">
              <div className="flex justify-between"><dt className="text-muted">Subtotaal</dt><dd>{formatEuro(cart.subtotalCents)}</dd></div>
              {tieredCents > 0 ? (<div className="flex justify-between text-success"><dt>Staffelkorting ({tiered?.percentOff}% vanaf {tiered?.minItems})</dt><dd>− {formatEuro(tieredCents)}</dd></div>) : null}
              {voucherCents > 0 ? (<div className="flex justify-between text-success"><dt>Korting ({voucher?.code})</dt><dd>− {formatEuro(voucherCents)}</dd></div>) : null}
              <div className="flex justify-between"><dt className="text-muted">{pickupMode ? "Afhalen in winkel" : "Verzending"}</dt><dd>{baseShipping === 0 ? "Gratis" : formatEuro(baseShipping)}</dd></div>
              {surcharge > 0 ? (<div className="flex justify-between"><dt className="text-muted">Snellere levering</dt><dd>+ {formatEuro(surcharge)}</dd></div>) : null}
              {giftcardCents > 0 ? (<div className="flex justify-between text-success"><dt>Cadeaubon</dt><dd>− {formatEuro(giftcardCents)}</dd></div>) : null}
              <div className="flex justify-between border-t border-line pt-2 font-medium">
                <dt>{giftcardCents > 0 ? "Te betalen" : "Totaal"}</dt>
                <dd className="font-display text-lg">{formatEuro(payableCents)}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
