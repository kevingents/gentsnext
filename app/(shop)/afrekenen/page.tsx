"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useCart } from "@/components/cart/cart-context";
import { useT } from "@/components/i18n/locale-provider";
import { DeliveryOptions } from "@/components/cart/delivery-options";
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
// label = i18n-key; wordt bij het renderen vertaald via t().
const FIELDS: Field[] = [
  { name: "firstName", label: "checkout.firstname", col: 1, autoComplete: "given-name" },
  { name: "lastName", label: "checkout.lastname", col: 1, autoComplete: "family-name" },
  { name: "email", label: "checkout.email", col: 1, type: "email", autoComplete: "email", inputMode: "email" },
  { name: "phone", label: "checkout.phone_optional", col: 1, type: "tel", optional: true, autoComplete: "tel", inputMode: "tel" },
  { name: "postalCode", label: "checkout.postalcode", col: 1, autoComplete: "postal-code", placeholder: "1234 AB" },
  { name: "houseNumber", label: "checkout.housenumber", col: 1, autoComplete: "address-line2", inputMode: "numeric", placeholder: "12" },
  { name: "street", label: "checkout.street", col: 1, autoComplete: "address-line1" },
  { name: "city", label: "checkout.city", col: 1, autoComplete: "address-level2" },
];

const POSTCODE_RE = /^[1-9][0-9]{3}\s?[a-zA-Z]{2}$/;
const HOUSENR_RE = /^[0-9]+[a-zA-Z0-9 -]*$/;

function Steps({ step }: { step: "gegevens" | "betalen" }) {
  const t = useT();
  const steps: { label: string; done?: boolean; active?: boolean }[] = [
    { label: t("checkout.step_cart"), done: true },
    { label: t("checkout.step_delivery"), done: step === "betalen", active: step === "gegevens" },
    { label: t("checkout.step_payment"), active: step === "betalen" },
    { label: t("checkout.step_confirmation") },
  ];
  const activeLabel = steps.find((s) => s.active)?.label;
  return (
    <div className="mt-3">
      <ol className="flex items-center">
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
      {/* Mobiel: de actieve stapnaam op een eigen regel — inline liep de
          verbindingslijn dwars door het label (te weinig ruimte op 390px). */}
      {activeLabel ? <p className="mt-1.5 font-sans text-xs font-medium text-ink sm:hidden">{activeLabel}</p> : null}
    </div>
  );
}

export default function AfrekenenPage() {
  const t = useT();
  return (
    <Suspense fallback={<div className="mx-auto max-w-page px-gutter py-12"><h1 className="text-display-md">{t("cart.checkout")}</h1></div>}>
      <CheckoutForm />
    </Suspense>
  );
}

function CheckoutForm() {
  const cart = useCart();
  const t = useT();
  const params = useSearchParams();
  const canceled = params.get("geannuleerd") === "1";

  const [form, setForm] = useState<Record<string, string>>({});
  const [business, setBusiness] = useState(false);
  const [agree, setAgree] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Veld-niveau fout (naam van het veld) — markeert + focust het ontbrekende adresveld.
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  // Mobiel: inklapbaar besteloverzicht bóven het formulier (op lg staat het ernaast).
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Eén DeliveryOptions-instantie per viewport: twee tegelijk gemounte
  // instanties deden dubbele estimate-POSTs en konden elkaars keuze terugzetten.
  // null = nog niet gehydrateerd (render dan alleen de desktop-variant, CSS-verborgen).
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
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
  // Fail-closed: zolang de check niet geslaagd is tonen we GEEN winkellijst —
  // een volledige lijst tijdens laden/fout liet winkels zonder voorraad zien.
  const [pickupAvailState, setPickupAvailState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [pickupAvailRefresh, setPickupAvailRefresh] = useState(0);
  const cartSig = cart.lines.map((l) => `${l.sku}:${l.qty}`).join("|");
  useEffect(() => {
    if (!pickupMode || cart.lines.length === 0) { setPickupAvail({}); setPickupAvailState("idle"); return; }
    let active = true;
    setPickupAvailState("loading");
    fetch("/api/pickup-availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: cart.lines.map((l) => ({ sku: l.sku, qty: l.qty })) }),
    })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => {
        if (!active) return;
        const map: Record<string, StoreAvail> = {};
        for (const s of (d.stores || []) as StoreAvail[]) map[s.name] = s;
        setPickupAvail(map);
        setPickupAvailState("loaded");
      })
      .catch(() => { if (active) { setPickupAvail({}); setPickupAvailState("error"); } });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupMode, cartSig, pickupAvailRefresh]);
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
  // Alleen winkels waar de HELE bestelling op voorraad ligt (Kevin, 23 juli):
  // de lijst met "1/3 op voorraad"-winkels was onoverzichtelijk en een halve
  // afhaling wil niemand. Zonder geslaagde check géén lijst (laden/fout toont
  // een status i.p.v. de dropdown); geen enkele winkel compleet → melding.
  const pickupAvailLoaded = pickupAvailState === "loaded";
  const pickupStores = useMemo(() => {
    if (!pickupAvailLoaded) return [];
    return storesByAvail.filter((s) => pickupAvail[s.name]?.allOk);
  }, [storesByAvail, pickupAvail, pickupAvailLoaded]);
  // Viel de gekozen winkel weg uit de lijst → schakel naar de eerste complete
  // winkel; is er géén complete winkel, wis de keuze (de submit-validatie
  // blokkeert dan met een duidelijke melding).
  useEffect(() => {
    if (!pickupMode) return;
    if (!pickupStores.length) {
      if (pickupAvailLoaded && pickupStore) setPickupStore("");
      return;
    }
    if (!pickupStores.some((s) => s.name === pickupStore)) setPickupStore(pickupStores[0].name);
  }, [pickupMode, pickupStores, pickupStore, pickupAvailLoaded]);
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

  // Voucher hoort bij de actuele winkelwagen: wijzigt de inhoud, dan hervalideren
  // we de code server-side — anders kan het getoonde totaal afwijken van wat de
  // server straks echt rekent (bv. minimum-bedrag vervalt na verwijderen artikel).
  const voucherRef = useRef(voucher);
  voucherRef.current = voucher;
  useEffect(() => {
    const v = voucherRef.current;
    if (!v || cart.lines.length === 0) return;
    let active = true;
    fetch("/api/redeem-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: v.code, subtotalCents: cart.subtotalCents, amountCents: cart.subtotalCents }),
    })
      .then(async (r) => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => {
        if (!active) return;
        // Alleen bij een ECHT ongeldig-antwoord strippen: een niet-ok respons (bv. de
        // gedeelde rate-limit op /api/redeem-code) mag een geldige voucher nooit stil
        // weghalen — dan houden we 'm aan.
        if (!ok) return;
        if (d.type === "voucher") {
          setVoucher((cur) => (cur && cur.code === d.code ? { code: d.code, discountCents: d.discountCents, label: d.label } : cur));
        } else {
          setVoucher(null);
          setCodeErr(t("checkout.voucher_removed"));
          setSummaryOpen(true); // melding ook op mobiel zichtbaar (samenvatting is daar ingeklapt)
        }
      })
      .catch(() => {});
    return () => { active = false; };
    // Bewust alléén op cart-wijziging; voucherRef voorkomt een her-valideer-lus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartSig]);

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
        setCodeErr(d.error || t("checkout.error_code_unknown"));
      }
    } catch {
      setCodeErr(t("checkout.error_code_check"));
    } finally {
      setCodeBusy(false);
    }
  }

  // Nog niet gehydrateerd uit localStorage → neutraal skelet i.p.v. eerst de
  // lege-staat flitsen en dan de gevulde checkout (jarring, lijkt op dataverlies).
  if (!cart.hydrated) {
    return (
      <div className="mx-auto max-w-page px-gutter py-4" aria-busy="true">
        <div className="h-9 w-48 animate-pulse rounded-card bg-surface" />
        <div className="mt-5 grid gap-6 lg:gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="h-72 animate-pulse rounded-card bg-surface" />
          <div className="h-72 animate-pulse rounded-card bg-surface" />
        </div>
      </div>
    );
  }

  if (cart.lines.length === 0 && !notice) {
    return (
      <BrandedState eyebrow={t("cart.checkout")} title={t("cart.empty_title")} intro={t("cart.empty_cta")}>
        <Link href="/collections/pakken" className="btn-primary">{t("cart.empty.shopButton")}</Link>
      </BrandedState>
    );
  }

  // Stap 1 → 2: valideer gegevens & bezorging vóór we naar betalen gaan.
  function goToPayment() {
    setError("");
    setFieldError(null);
    // Veld-fout: markeer + focus het veld zolang het nog op het scherm staat
    // (op stap 2 zijn de adresvelden niet meer zichtbaar).
    const fieldFail = (name: string, msg: string) => {
      setFieldError(name);
      setError(msg);
      document.getElementById(`checkout-field-${name}`)?.focus();
    };
    if (pickupMode) {
      // Doorgaan kan pas als de voorraad-check geslaagd is én de gekozen winkel
      // de héle bestelling heeft — anders kon je tijdens het laden doorklikken.
      if (!pickupAvailLoaded) { setError(t("checkout.pickup_checking")); return; }
      if (!pickupStore || !pickupAvail[pickupStore]?.allOk) { setError(t("checkout.error_pickup_store")); return; }
    } else {
      if (!POSTCODE_RE.test(form.postalCode || "")) { fieldFail("postalCode", t("checkout.error_postcode")); return; }
      if (!HOUSENR_RE.test((form.houseNumber || "").trim())) { fieldFail("houseNumber", t("checkout.error_housenumber")); return; }
      // Straat/plaats kunnen leeg blijven als de postcode-API het adres niet kent
      // (bv. nieuwbouw) — de server weigert lege adresvelden, dus hier al blokkeren.
      if (!(form.street || "").trim()) { fieldFail("street", t("checkout.error_address_fields")); return; }
      if (!(form.city || "").trim()) { fieldFail("city", t("checkout.error_address_fields")); return; }
    }
    if (!(form.firstName || "").trim() || !(form.lastName || "").trim() || !/.+@.+\..+/.test(form.email || "")) {
      setError(t("checkout.error_name_email")); return;
    }
    if (business && !(form.companyName || "").trim()) { setError(t("checkout.error_company_name")); return; }
    setError("");
    setStep("betalen");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setUnavailableSkus([]);
    if (pickupMode) {
      if (!pickupStore || !pickupAvail[pickupStore]?.allOk) { setError(t("checkout.error_pickup_store")); return; }
    } else {
      // Lichte validatie (datakwaliteit → minder mislukte bezorgingen).
      if (!POSTCODE_RE.test(form.postalCode || "")) {
        setError(t("checkout.error_postcode"));
        return;
      }
      if (!HOUSENR_RE.test((form.houseNumber || "").trim())) {
        setError(t("checkout.error_housenumber"));
        return;
      }
    }
    if (business && !(form.companyName || "").trim()) {
      setError(t("checkout.error_company_name"));
      return;
    }
    if (!agree) {
      setError(t("checkout.error_terms"));
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
        setError(data.error || t("common.error"));
        const skus = Array.isArray(data.unavailableSkus) ? data.unavailableSkus.map(String) : [];
        setUnavailableSkus(skus);
        // Winkelvoorraad wijzigde tussen kiezen en afrekenen → lijst verversen,
        // zodat de klant meteen de nog-wel-complete winkels ziet.
        if (data.pickupUnavailable) setPickupAvailRefresh((n) => n + 1);
        // Mobiel: het overzicht staat standaard dicht — klap open zodat de
        // rood-gemarkeerde regel(s) vindbaar zijn bij een voorraad-weigering.
        if (skus.length) setSummaryOpen(true);
        return;
      }
      if (data.configured && data.checkoutUrl) {
        // NIET hier wissen: bij annuleren op de Mollie-pagina moet de winkelwagen nog
        // klaarstaan (de bevestigingspagina wist 'm via <ClearCart /> pas bij 'paid').
        window.location.href = data.checkoutUrl; // door naar Mollie (iDEAL)
      } else {
        setNotice(`${data.message} ${t("checkout.order_number_is")} ${data.orderNumber}. ${t("checkout.contact_soon_note")}`);
      }
    } catch {
      setError(t("checkout.error_submit"));
    } finally {
      setBusy(false);
    }
  }

  if (notice) {
    return (
      <BrandedState eyebrow={t("giftcard.thanksShort")} title={t("checkout.order_noted_title")} intro={notice}>
        <Link href="/" className="btn-ghost">{t("common.back_home")}</Link>
      </BrandedState>
    );
  }

  return (
    <div className="mx-auto max-w-page px-gutter py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="text-2xl font-display font-light sm:text-3xl">{t("cart.checkout")}</h1>
        <div className="min-w-[16rem] flex-1"><Steps step={step} /></div>
      </div>

      {canceled ? (
        <div className="mt-6 rounded-card border border-line bg-surface px-4 py-3 font-sans text-sm text-ink-soft">
          <span className="font-medium text-ink">{t("checkout.payment_canceled")}</span> {t("checkout.payment_canceled_note")}
        </div>
      ) : null}

      {/* Al klant? — inloggen vult gegevens & adres vast in. Gast blijft mogelijk. */}
      {step === "gegevens" && prefill && !prefill.loggedIn ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-surface px-3 py-2 font-sans text-xs">
          <span className="text-ink-soft"><span className="font-medium text-ink">{t("checkout.existing_customer")}</span> {t("checkout.login_suggestion")}</span>
          <Link href="/account/login?next=/afrekenen" className="btn-ghost !px-4 !py-2 whitespace-nowrap">{t("common.login")}</Link>
        </div>
      ) : null}
      {step === "gegevens" && prefill?.loggedIn ? (
        <div className="mt-6 rounded-card border border-line bg-surface px-4 py-3 font-sans text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-ink-soft"><span className="font-medium text-ink">{t("checkout.welcome_back")}</span> {t("checkout.prefill_note")}{prefill.email ? ` (${prefill.email})` : ""}.</span>
            {prefill.addresses && prefill.addresses.length > 1 ? (
              <label className="flex items-center gap-2">
                <span className="text-xs text-muted">{t("checkout.delivery_address")}</span>
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
            {([["checkout.private", false], ["checkout.business", true]] as const).map(([label, val]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setBusiness(val);
                  if (!val) setForm((p) => ({ ...p, companyName: "", vatNumber: "" }));
                }}
                className={`px-4 py-2.5 font-sans text-sm transition-colors ${business === val ? "bg-ink text-canvas" : "text-ink-soft hover:text-ink"}`}
              >
                {t(label)}
              </button>
            ))}
          </div>

          {business ? (
            <>
              <p className="label-brand mt-4">{t("checkout.business_info")}</p>
              <div className="mt-2 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
                <label className="col-span-2 block">
                  <span className="font-sans text-sm text-ink">{t("checkout.company_name")}</span>
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
                    {t("checkout.vat_number")} <span className="text-muted">{t("common.optional")}</span>
                  </span>
                  <input
                    value={form.vatNumber || ""}
                    onChange={(e) => setForm((p) => ({ ...p, vatNumber: e.target.value.toUpperCase() }))}
                    autoComplete="off"
                    placeholder="NL000000000B00"
                    className="mt-1 w-full border border-line bg-canvas px-4 py-2 font-sans text-sm focus:border-ink focus:outline-none"
                  />
                  <span className="mt-1 block font-sans text-xs text-muted">{t("checkout.vat_note")}</span>
                </label>
              </div>
            </>
          ) : null}

          {/* Bezorgen of afhalen in winkel (click & collect) */}
          <p className="label-brand mt-4">{t("checkout.receive_label")}</p>
          <div className="mt-3 inline-flex rounded-card border border-line p-0.5">
            {([["checkout.receive_delivery", false], ["checkout.receive_pickup", true]] as const).map(([label, val]) => (
              <button
                key={label}
                type="button"
                onClick={() => setPickupMode(val)}
                className={`px-4 py-2.5 font-sans text-sm transition-colors ${pickupMode === val ? "bg-ink text-canvas" : "text-ink-soft hover:text-ink"}`}
              >
                {t(label)}
              </button>
            ))}
          </div>
          {pickupMode ? (
            pickupAvailState === "error" ? (
              /* Check mislukt → géén lijst tonen (fail-closed), wel opnieuw kunnen proberen. */
              <div className="mt-4 rounded-card border border-line bg-surface px-4 py-3 font-sans text-sm text-ink-soft" role="status">
                <p>{t("checkout.pickup_check_failed")}</p>
                <button
                  type="button"
                  onClick={() => setPickupAvailRefresh((n) => n + 1)}
                  className="mt-2 text-ink underline underline-offset-4"
                >
                  {t("checkout.pickup_retry")}
                </button>
              </div>
            ) : !pickupAvailLoaded ? (
              <p className="mt-4 rounded-card border border-line bg-surface px-4 py-3 font-sans text-sm text-ink-soft" role="status" aria-busy="true">
                {t("checkout.pickup_checking")}
              </p>
            ) : !pickupStores.length ? (
              /* Geen enkele winkel heeft de hele bestelling — duidelijk zeggen
                 i.p.v. een lege dropdown; bezorgen is dan de weg. */
              <p className="mt-4 rounded-card border border-line bg-surface px-4 py-3 font-sans text-sm text-ink-soft" role="status">
                {t("checkout.pickup_none_full")}
              </p>
            ) : (
              <label className="mt-4 block">
                <span className="font-sans text-sm text-ink">{t("checkout.choose_store")}</span>
                {/* Alleen alles-op-voorraad-winkels → geen suffixen meer nodig. */}
                <select
                  value={pickupStore}
                  onChange={(e) => setPickupStore(e.target.value)}
                  className="mt-1 w-full border border-line bg-canvas px-4 py-2 font-sans text-sm focus:border-ink focus:outline-none"
                >
                  {pickupStores.map((s) => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
                {pickupStore ? (
                  <span className="mt-1 block font-sans text-xs text-success">{t("checkout.pickup_all_ok", { store: pickupStore })}</span>
                ) : null}
              </label>
            )
          ) : null}

          <p className="label-brand mt-4">{pickupMode ? t("checkout.contact_details") : t("checkout.contact_delivery")}</p>
          <div className="mt-2 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
            {FIELDS.filter((f) => !pickupMode || !["postalCode", "houseNumber", "street", "city"].includes(f.name)).map((f) => (
              <label key={f.name} className={f.col === 2 ? "col-span-2 block" : "block"}>
                <span className="font-sans text-sm text-ink">{t(f.label)}</span>
                <input
                  id={`checkout-field-${f.name}`}
                  type={f.type ?? "text"}
                  inputMode={f.inputMode}
                  autoComplete={f.autoComplete}
                  placeholder={f.placeholder}
                  value={form[f.name] || ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((p) => ({ ...p, [f.name]: v }));
                    if (fieldError === f.name) setFieldError(null);
                  }}
                  required={!f.optional}
                  aria-invalid={fieldError === f.name || undefined}
                  className={`mt-1 w-full border bg-canvas px-4 py-2 font-sans text-sm focus:border-ink focus:outline-none ${fieldError === f.name ? "border-danger" : "border-line"}`}
                />
              </label>
            ))}
            {!pickupMode ? (
              <p className="col-span-full font-sans text-xs text-muted">{t("checkout.delivery_nl_only")}</p>
            ) : null}
          </div>

          {/* Mobiel: bezorgoptie + datum ín de stap zelf — in het (dichtgeklapte)
              overzicht hierboven zou de klant de keuze anders nooit zien. Desktop
              toont 'm in de zijkolom (hidden lg:block daar). */}
          {/* empty:hidden — DeliveryOptions rendert null tot de schatting binnen
              is; zonder dit stond er even een losse scheidingslijn. Alleen
              mounten als we zeker mobiel zijn (isDesktop === false): CSS-hidden
              zou een tweede fetchende instantie betekenen. */}
          {!pickupMode && isDesktop === false ? (
            <div className="mt-5 border-t border-line pt-4 empty:hidden lg:hidden">
              <DeliveryOptions
                items={cart.lines.map((l) => ({ sku: l.sku, qty: l.qty }))}
                value={delivery}
                onChange={(m, s) => {
                  setDelivery(m);
                  setExpressSurcharge(m === "express" ? s : expressSurcharge || s);
                }}
              />
            </div>
          ) : null}

          {error ? (
            <div role="alert" className="mt-4 rounded-card border border-danger/40 bg-danger/5 px-4 py-3 font-sans text-sm text-danger">{error}</div>
          ) : null}
          <button type="button" onClick={goToPayment} className="btn-primary mt-5 w-full">
            {t("checkout.to_payment")}
          </button>
          </>
          ) : (
          <>
          <button type="button" onClick={() => { setStep("gegevens"); setError(""); }} className="mb-4 inline-flex items-center gap-1 font-sans text-sm text-ink-soft hover:text-ink">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {t("checkout.back_to_details")}
          </button>

          {/* Betaalmethode vooraf — geen tussenstop meer op Mollie's keuzescherm. */}
          {payableCents > 0 && methods.length ? (
            <>
              <p className="label-brand mt-4">{t("checkout.payment_method")}</p>
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

          {/* Mobiel: kortingscode/cadeaubon zichtbaar op de betaalstap — in het
              dichtgeklapte overzicht bovenaan zou het veld anders onvindbaar zijn.
              Desktop heeft het veld in de zijkolom (hidden lg:block daar). */}
          <div className="mt-4 border-t border-line pt-4 lg:hidden">
            {voucher ? (
              <div className="flex items-center justify-between font-sans text-sm">
                <span className="text-success">{t("checkout.discount_code")} {voucher.code} — {voucher.label}</span>
                <button type="button" onClick={() => setVoucher(null)} className="-my-2 py-2 text-muted underline">{t("checkout.remove_code")}</button>
              </div>
            ) : null}
            {giftcard ? (
              <div className={`flex items-center justify-between font-sans text-sm ${voucher ? "mt-2" : ""}`}>
                <span className="text-success">{t("checkout.giftcard_label")} {giftcard.code} — {t("checkout.giftcard_balance")} {formatEuro(giftcard.balanceCents)}</span>
                <button type="button" onClick={() => setGiftcard(null)} className="-my-2 py-2 text-muted underline">{t("checkout.remove_code")}</button>
              </div>
            ) : null}
            {!voucher || !giftcard ? (
              <details className={voucher || giftcard ? "mt-3" : ""}>
                <summary className="flex min-h-11 cursor-pointer list-none items-center font-sans text-sm text-ink underline underline-offset-4 [&::-webkit-details-marker]:hidden">
                  {t("checkout.code_placeholder")}
                </summary>
                <div className="mt-2 flex gap-2">
                  <input
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyCode();
                      }
                    }}
                    placeholder={t("checkout.code_placeholder")}
                    aria-label={t("checkout.code_placeholder")}
                    className="w-full min-w-0 border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none"
                  />
                  <button type="button" onClick={applyCode} disabled={codeBusy} className="btn-ghost !px-4 !py-2 whitespace-nowrap">
                    {codeBusy ? "…" : t("common.apply")}
                  </button>
                </div>
                {codeErr ? <p className="mt-1 font-sans text-xs text-danger">{codeErr}</p> : null}
              </details>
            ) : null}
          </div>

          <label className="mt-3 flex items-start gap-2 font-sans text-sm">
            <input type="checkbox" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} className="mt-0.5 h-4 w-4 accent-ink" />
            <span className="text-ink-soft">{t("checkout.newsletter_opt_in")}</span>
          </label>

          <label className="mt-3 flex items-start gap-2 font-sans text-sm">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 accent-ink" />
            <span className="text-ink-soft">
              {t("checkout.agree_terms")} <Link href="/pages/algemene-voorwaarden" className="text-ink underline">{t("common.terms_link")}</Link> {t("checkout.and_the")}{" "}
              <Link href="/pages/retourneren" className="text-ink underline">{t("common.withdrawal_link")}</Link> {t("checkout.withdrawal_note")}
            </span>
          </label>

          {error ? (
            <div role="alert" className="mt-4 rounded-card border border-danger/40 bg-danger/5 px-4 py-3 font-sans text-sm">
              <p className="text-danger">{error}</p>
              {unavailableSkus.length ? (
                <button type="button" onClick={removeUnavailable} className="btn-ghost mt-3 !px-4 !py-2">
                  {t("checkout.remove_unavailable")}
                </button>
              ) : null}
            </div>
          ) : null}

          <button type="submit" disabled={busy} className="btn-primary mt-4 w-full">
            {busy
              ? t("common.processing")
              : payableCents === 0
                ? t("checkout.complete_with_giftcard")
                : `${t("checkout.pay_securely")} ${formatEuro(payableCents)}`}
          </button>
          {/* Geen FooterPayments-strip hier: die chips zijn wit-op-wit buiten de
              donkere footer, en de gekozen methode staat al in het betaalgrid. */}
          <p className="mt-3 font-sans text-xs text-muted">
            {payableCents === 0
              ? t("checkout.giftcard_covers_full")
              : `${t("checkout.payment_via")} ${methods.find((m) => m.id === payMethod)?.description || "Mollie"} · ${t("checkout.payment_note")}`}
          </p>
          </>
          )}
        </form>

        {/* Overzicht — op mobiel als inklapbaar blok bóven het formulier, zodat de
            bezorgkeuze en het kortingscode-veld vóór de betaalknop zichtbaar zijn. */}
        <aside className="order-first lg:order-none lg:sticky lg:top-20 lg:h-fit">
          <button
            type="button"
            onClick={() => setSummaryOpen((v) => !v)}
            aria-expanded={summaryOpen}
            className="flex w-full items-center justify-between border border-line px-4 py-3 lg:hidden"
          >
            <span className="label-brand">{t("checkout.order_summary")}</span>
            <span className="flex items-center gap-2">
              <span className="font-display text-base">{formatEuro(payableCents)}</span>
              <svg viewBox="0 0 12 12" aria-hidden className={`h-3 w-3 text-muted transition-transform ${summaryOpen ? "rotate-180" : ""}`}>
                <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
          <div className={`border border-line p-4 ${summaryOpen ? "border-t-0" : "hidden"} lg:block lg:border-t`}>
            {/* Kop dubbelt op mobiel met de toggle-knop → alleen op desktop tonen. */}
            <p className="label-brand mb-3 hidden lg:block">{t("checkout.order_summary")}</p>
            {/* Regelitems óók op mobiel: bij een voorraad-weigering moet de klant
                het gemarkeerde artikel kunnen zien en verwijderen. */}
            <ul className="space-y-3">
              {cart.lines.map((l) => {
                const unavailable = unavailableSet.has(l.sku.toLowerCase());
                return (
                  <li key={l.id} className={`flex gap-3 ${unavailable ? "-mx-2 rounded-card border border-danger/30 bg-danger/5 px-2 py-1.5" : ""}`}>
                    <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-card bg-surface">
                      {l.imageUrl ? <Image src={l.imageUrl} alt={l.title} fill sizes="48px" className="object-cover" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-sans text-sm">{l.title}</p>
                      <p className="font-sans text-xs text-muted">{[l.color, l.size && `${t("common.size")} ${l.size}`, `${l.qty}×`].filter(Boolean).join(" · ")}</p>
                      {unavailable ? <p className="mt-0.5 font-sans text-xs font-medium text-danger">{t("checkout.line_unavailable")}</p> : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end justify-between">
                      <p className="font-sans text-sm">{formatEuro(l.priceCents * l.qty)}</p>
                      <button
                        type="button"
                        onClick={() => removeLine(l.id)}
                        aria-label={t("checkout.remove_item_aria", { title: l.title })}
                        className="font-sans text-xs text-muted underline underline-offset-2 hover:text-ink"
                      >
                        {t("cart.line.remove")}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {/* Bezorgkeuze: op mobiel staat die ín stap 1 van het formulier —
                deze desktop-instantie mount pas als we ZEKER desktop zijn
                (=== true, niet tijdens de null-hydratiefase): anders vuurde de
                pre-hydration-mount op mobiel alsnog een extra estimate-POST af.
                Er gaat geen SSR-content verloren: de opties renderen sowieso
                pas na de fetch. */}
            {isDesktop === true ? (
              <div className="mt-4 hidden border-t border-line pt-4 lg:block">
                {pickupMode ? (
                  <div className="font-sans text-sm">
                    <p className="font-medium text-ink">{t("checkout.receive_pickup")}</p>
                    <p className="mt-1 text-ink-soft">{t("checkout.pickup_summary", { store: pickupStore || t("checkout.choose_store") })}</p>
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
            ) : null}
            {/* Kortingscode-blok: toegepaste codes + foutmelding zijn op ÁLLE
                breedtes zichtbaar (de voucher-hervalidatie opent de mobiele
                samenvatting en moet hier kunnen uitleggen waarom het totaal
                veranderde). Alleen het invoerveld is desktop-only — op mobiel
                zit dat als disclosure in stap 2. */}
            <div className={`mt-4 border-t border-line pt-4 ${voucher || giftcard || codeErr ? "" : "hidden lg:block"}`}>
              {voucher ? (
                <div className="flex items-center justify-between font-sans text-sm">
                  <span className="text-success">{t("checkout.discount_code")} {voucher.code} — {voucher.label}</span>
                  <button type="button" onClick={() => setVoucher(null)} className="-my-2 py-2 text-muted underline">{t("checkout.remove_code")}</button>
                </div>
              ) : null}
              {giftcard ? (
                <div className={`flex items-center justify-between font-sans text-sm ${voucher ? "mt-2" : ""}`}>
                  <span className="text-success">{t("checkout.giftcard_label")} {giftcard.code} — {t("checkout.giftcard_balance")} {formatEuro(giftcard.balanceCents)}</span>
                  <button type="button" onClick={() => setGiftcard(null)} className="-my-2 py-2 text-muted underline">{t("checkout.remove_code")}</button>
                </div>
              ) : null}
              {codeErr ? <p className={`font-sans text-xs text-danger ${voucher || giftcard ? "mt-2" : ""}`}>{codeErr}</p> : null}
              {/* Eén veld: kortingscode óf cadeaubon (desktop; mobiel in stap 2) */}
              <div className={`hidden lg:block ${voucher || giftcard || codeErr ? "mt-3" : ""}`}>
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
                    placeholder={t("checkout.code_placeholder")}
                    aria-label={t("checkout.code_placeholder")}
                    className="w-full min-w-0 border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none"
                  />
                  <button type="button" onClick={applyCode} disabled={codeBusy} className="btn-ghost !px-4 !py-2 whitespace-nowrap">
                    {codeBusy ? "…" : t("common.apply")}
                  </button>
                </div>
              </div>
            </div>
            <dl className="mt-4 space-y-1.5 border-t border-line pt-4 font-sans text-sm">
              <div className="flex justify-between"><dt className="text-muted">{t("checkout.subtotal")}</dt><dd>{formatEuro(cart.subtotalCents)}</dd></div>
              {tieredCents > 0 ? (<div className="flex justify-between text-success"><dt>{t("checkout.tiered_detail", { percent: tiered?.percentOff ?? 0, min: tiered?.minItems ?? 0 })}</dt><dd>− {formatEuro(tieredCents)}</dd></div>) : null}
              {voucherCents > 0 ? (<div className="flex justify-between text-success"><dt>{t("checkout.discount")} ({voucher?.code})</dt><dd>− {formatEuro(voucherCents)}</dd></div>) : null}
              <div className="flex justify-between"><dt className="text-muted">{pickupMode ? t("checkout.receive_pickup") : t("checkout.shipping")}</dt><dd>{baseShipping === 0 ? t("checkout.free") : formatEuro(baseShipping)}</dd></div>
              {surcharge > 0 ? (<div className="flex justify-between"><dt className="text-muted">{t("checkout.express_shipping")}</dt><dd>+ {formatEuro(surcharge)}</dd></div>) : null}
              {giftcardCents > 0 ? (<div className="flex justify-between text-success"><dt>{t("checkout.giftcard_label")}</dt><dd>− {formatEuro(giftcardCents)}</dd></div>) : null}
              <div className="flex justify-between border-t border-line pt-2 font-medium">
                <dt>{giftcardCents > 0 ? t("checkout.to_pay") : t("checkout.total")}</dt>
                <dd className="font-display text-lg">{formatEuro(payableCents)}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
