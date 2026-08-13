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
import { huidigeAttributie } from "@/lib/attributie-client";
import { TrackAb } from "@/components/analytics/track-ab";
import { formatEuro, tieredDiscountCents, type TieredDiscountCfg } from "@/lib/pricing";
import { enabledZones, DEFAULT_COUNTRY, zoneFor, shippingCentsFor, type ShippingZoneOverrides } from "@/lib/shipping-zones";
import { splitMethods, type PaymentChoice } from "@/lib/payment-methods";

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
  // Bezorgland: bepaalt tarief, gratis-drempel én postcode-formaat. Stond vast
  // op NL terwijl de bezorgpagina BE/DE/EU belooft (UX-audit).
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  /* Welke landen aanstaan en wat ze kosten is een knop in de tool; de tabel in
     de code is alleen de startwaarde (en het vangnet als het ophalen faalt).
     Landnaam en postcode-patroon komen wél uit die tabel — dat is techniek. */
  const [zoneCfg, setZoneCfg] = useState<ShippingZoneOverrides>({});
  useEffect(() => {
    let active = true;
    fetch("/api/verzendlanden")
      .then((r) => r.json())
      .then((d) => {
        if (!active || !Array.isArray(d?.zones)) return;
        const map: ShippingZoneOverrides = {};
        for (const z of d.zones) map[String(z.code)] = z;
        setZoneCfg(map);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  const zone = zoneFor(country, zoneCfg);
  const countries = enabledZones(zoneCfg);
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

  // begin_checkout hoort bij het ÓPENEN van de checkout, niet bij het indrukken
  // van de betaalknop. Stond het op die knop, dan telde alleen wie helemaal
  // doorklikte als "gestart" — en was de afhaak binnen de checkout per definitie
  // onzichtbaar, want de noemer ontbrak. Eén keer per bezoek aan deze pagina.
  const checkoutGemeld = useRef(false);
  useEffect(() => {
    if (checkoutGemeld.current || !cart.hydrated || !cart.lines.length) return;
    checkoutGemeld.current = true;
    track("checkout_start", {
      valueCents: cart.subtotalCents,
      props: { items: cart.lines.length, stuks: cart.count },
    });
    track("checkout_stap", { props: { stap: "gegevens" } });
  }, [cart.hydrated, cart.lines.length, cart.subtotalCents, cart.count]);

  // Betaalmethode vooraf kiezen (i.p.v. Mollie's gehoste keuzescherm). Alleen de
  // kopgroep krijgt een knop; payMethod "" betekent "geen methode meesturen" en
  // dát is precies de Mollie-pagina met álle methoden — zie "Overige" hieronder.
  type PayMethod = { id: string; description: string; image: string };
  const [pay, setPay] = useState<PaymentChoice>({ methods: [], top: [], maxVisible: 3, ab: [] });
  const [payMethod, setPayMethod] = useState("");
  // Heeft de klant zelf een keuze gemaakt? Zo niet, dan mag een landwissel de
  // voorselectie nog verzetten (BE → Bancontact); daarna nooit meer.
  const payTouched = useRef(false);
  // De kopgroep hangt aan het BEZORGLAND, en een lopend experiment kan de
  // volgorde overschrijven. Beide weet alleen de server (instellingen + de
  // ab-cookie), dus we halen de uitkomst op in plaats van 'm hier na te rekenen.
  useEffect(() => {
    let active = true;
    fetch(`/api/payment-methods?land=${encodeURIComponent(country)}`)
      .then((r) => r.json())
      .then((d) => { if (active && d?.ok !== false) setPay(d as PaymentChoice); })
      .catch(() => {});
    return () => { active = false; };
  }, [country]);

  const methods = pay.methods;
  const { visible: payVisible, rest: payRest } = useMemo(
    () => splitMethods(pay.methods, pay.top, pay.maxVisible),
    [pay],
  );

  // Voorselectie = de eerste knop van de kopgroep, zolang de klant zelf nog niets
  // koos. Zonder dit stond de keuze op de eerste methode die Mollie toevallig
  // teruggaf, wat in België iDEAL kon zijn.
  useEffect(() => {
    if (payTouched.current) return;
    setPayMethod(payVisible[0]?.id || "");
  }, [payVisible]);


  const [delivery, setDelivery] = useState<"standard" | "express">("standard");
  const [expressSurcharge, setExpressSurcharge] = useState(0);
  // Afhalen in winkel (click & collect): gratis, geen adres nodig.
  const [pickupMode, setPickupMode] = useState(false);
  const [pickupStore, setPickupStore] = useState("");
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
  // Alleen winkels waar de HELE bestelling op voorraad ligt (Kevin, 23 juli):
  // de lijst met "1/3 op voorraad"-winkels was onoverzichtelijk en een halve
  // afhaling wil niemand. Zonder geslaagde check géén lijst (laden/fout toont
  // een status i.p.v. de dropdown); geen enkele winkel compleet → melding.
  // De lijst komt uit hetzélfde availability-antwoord (bevat alle winkels) —
  // een aparte /api/stores-fetch gaf een race met een ongefilterde eerste keus.
  const pickupAvailLoaded = pickupAvailState === "loaded";
  const pickupStores = useMemo(() => {
    if (!pickupAvailLoaded) return [];
    return Object.values(pickupAvail)
      .filter((s) => s.allOk)
      .sort((a, b) => a.name.localeCompare(b.name, "nl"))
      .map((s) => ({ name: s.name, city: s.city }));
  }, [pickupAvail, pickupAvailLoaded]);
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

  type PrefillAddr = { id: string; label: string; firstName: string; lastName: string; street: string; houseNumber: string; postalCode: string; city: string; country?: string };
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
    // Land meenemen: anders botst een BE/DE-adres op de NL-postcodecontrole.
    if (a.country && a.country !== country) setCountry(a.country);
  }

  // Adres-autofill: postcode + huisnummer → straat + plaats.
  useEffect(() => {
    const pc = (form.postalCode || "").replace(/\s/g, "").toUpperCase();
    const nr = (form.houseNumber || "").trim();
    // Postcode-API is NL-only; voor BE/DE/EU vult de klant zelf straat + plaats.
    if (country !== DEFAULT_COUNTRY || !/^[1-9][0-9]{3}[A-Z]{2}$/.test(pc) || !nr) return;
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
  }, [form.postalCode, form.houseNumber, country]);

  const baseShipping = pickupMode
    ? 0
    : shippingCentsFor(country, cart.subtotalCents, { rateCents: shipCents, freeFromCents: freeShipCents });
  const surcharge = pickupMode ? 0 : delivery === "express" ? expressSurcharge : 0;
  const shippingCents = baseShipping + surcharge;
  const itemCount = cart.lines.reduce((n, l) => n + l.qty, 0);
  const tieredCents = tieredDiscountCents(itemCount, cart.subtotalCents, tiered);
  const voucherCents = voucher?.discountCents ?? 0;
  const discountCents = Math.min(cart.subtotalCents, voucherCents + tieredCents);
  const totalCents = Math.max(0, cart.subtotalCents - discountCents) + shippingCents;
  // Cadeaubon dekt (een deel van) het hele bedrag incl. verzending.
  const giftcardCents = giftcard ? Math.min(giftcard.balanceCents, totalCents) : 0;
  const clientPayableCents = Math.max(0, totalCents - giftcardCents);
  // Server-correctie na een prijs-409: toon en gebruik het échte totaal zodat
  // de klant met één extra klik alsnog voor het juiste bedrag kan afrekenen.
  const [serverTotalOverride, setServerTotalOverride] = useState<number | null>(null);
  const cartSigForTotal = cart.lines.map((l) => `${l.sku}:${l.qty}`).join("|");
  useEffect(() => { setServerTotalOverride(null); }, [cartSigForTotal, voucher?.code, giftcard?.code, pickupMode, delivery]);
  const payableCents = serverTotalOverride ?? clientPayableCents;

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
        track("giftcard_ingewisseld", { valueCents: d.balanceCents, props: { code: d.code } });
        setCodeInput("");
      } else if (d.type === "voucher") {
        setVoucher({ code: d.code, discountCents: d.discountCents, label: d.label });
        track("voucher_toegepast", { valueCents: d.discountCents, props: { coupon: d.code, label: d.label } });
        setCodeInput("");
      } else {
        // Een geweigerde code is een omzetlek dat je alleen ziet als je 'm meet:
        // de klant heeft een verwachting die de checkout niet waarmaakt, en
        // haakt precies daar af. De REDEN gaat mee, want "verlopen" vraagt om
        // een ander antwoord dan "bestaat niet".
        track("voucher_geweigerd", { props: { coupon: code.slice(0, 40), reden: String(d.error || "onbekend").slice(0, 80) } });
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
      if (!pickupAvailLoaded) {
        setError(t(pickupAvailState === "error" ? "checkout.pickup_check_failed" : "checkout.pickup_checking"));
        return;
      }
      if (!pickupStore || !pickupAvail[pickupStore]?.allOk) { setError(t("checkout.error_pickup_store")); return; }
    } else {
      if (!zone.postcode.test((form.postalCode || "").trim())) { fieldFail("postalCode", t("checkout.error_postcode")); return; }
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
    // GA4's add_shipping_info: de klant heeft zijn bezorgkeuze vastgelegd. Dit
    // is de stap die tot nu toe volledig ontbrak, waardoor de checkout één
    // zwarte doos was tussen "gestart" en "betaald" — je kon niet zien of mensen
    // op het adres, op de verzendkosten of op de betaalpagina afhaakten.
    track("verzendkeuze", {
      valueCents: payableCents,
      props: {
        methode: pickupMode ? "pickup" : delivery,
        ...(pickupMode ? { winkel: pickupStore } : {}),
        shippingCents,
      },
    });
    track("checkout_stap", { props: { stap: "betalen" } });
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
      if (!zone.postcode.test((form.postalCode || "").trim())) {
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
    // GA4's add_payment_info. `checkout_start` hoort niet hier maar bij het
    // ÓPENEN van de checkout (zie de useEffect hieronder): stond hij op dit
    // punt, dan telde alleen wie helemaal doorklikte als "gestart" en was de
    // afhaak in de checkout per definitie onzichtbaar.
    track("betaalkeuze", {
      valueCents: payableCents,
      props: {
        items: cart.lines.length,
        methode: pickupMode ? "pickup" : delivery,
        coupon: voucher?.code || "",
        betaalmethode: payMethod || "overig",
      },
    });
    // Niet-voorgevinkte nieuwsbrief-opt-in (AVG): alleen bij expliciete keuze.
    if (newsletter && form.email) {
      fetch("/api/newsletter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.email }) }).catch(() => {});
    }
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: { ...form, country },
          deliveryMethod: pickupMode ? "pickup" : delivery,
          pickupStore: pickupMode ? pickupStore : "",
          method: payMethod,
          voucherCode: voucher?.code || "",
          giftcardCode: giftcard?.code || "",
          // Server vergelijkt: wijkt het echte totaal af (prijs/actie gewijzigd
          // sinds toevoegen) → 409 i.p.v. stil een ander bedrag innen.
          expectedTotalCents: payableCents,
          // De campagne die deze klant bracht, vastgevroren op de order. Zonder
          // dit komt élke conversie bij Google en Meta binnen als "direct" en
          // lijkt betaalde reclame gratis.
          attributie: huidigeAttributie() ?? undefined,
          items: cart.lines.map((l) => ({ sku: l.sku, qty: l.qty, groupId: l.groupId, roleLabel: l.roleLabel })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.pickupUnavailable) {
          // Winkelvoorraad wijzigde tussen kiezen en afrekenen. NIET de
          // verwijder-artikelen-flow: de artikelen zijn elders wél leverbaar.
          // Terug naar stap 1 met een ververste lijst, zodat de klant zélf
          // opnieuw een (complete) winkel kiest — nooit stil herkiezen.
          track("checkout_fout", { valueCents: payableCents, props: { soort: "afhaalvoorraad", winkel: pickupStore } });
          setError(t("checkout.pickup_unavailable"));
          setPickupStore("");
          setPickupAvailRefresh((n) => n + 1);
          setStep("gegevens");
          return;
        }
        // Een afgebroken checkout is de duurste afhaak die er is: de klant wilde
        // betalen en kon het niet. Zonder dit event zie je alleen dat de order
        // ontbreekt, niet wáárom — en dat is precies het verschil tussen een
        // prijswijziging, een voorraadweigering en een echte storing.
        track("checkout_fout", {
          valueCents: payableCents,
          props: {
            soort: data.priceChanged ? "prijs_gewijzigd" : Array.isArray(data.unavailableSkus) && data.unavailableSkus.length ? "voorraad" : "overig",
            melding: String(data.error || "").slice(0, 120),
          },
        });
        setError(data.error || t("common.error"));
        // Prijs gewijzigd → knop toont voortaan het server-totaal; nogmaals
        // betalen gaat dan wél door (expectedTotalCents matcht weer).
        if (data.priceChanged && Number.isFinite(data.serverTotalCents)) setServerTotalOverride(data.serverTotalCents);
        const skus = Array.isArray(data.unavailableSkus) ? data.unavailableSkus.map(String) : [];
        setUnavailableSkus(skus);
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

      {/* min-w-0 op de twee kolommen: zonder dat staat hun minimumbreedte op
          "auto" en bepaalt het breedste onbreekbare stukje tekst diep in de
          kolom hoe breed de héle pagina wordt. Eén regel met white-space:nowrap
          blies de checkout op een telefoon van 375 naar 704px op. */}
      <div className="mt-5 grid gap-6 lg:gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Formulier */}
        <form onSubmit={submit} noValidate className="min-w-0">
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
                  placeholder={f.name === "postalCode" ? zone.postcodeExample : f.placeholder}
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
              <label className="col-span-full block">
                <span className="font-sans text-sm text-ink">{t("checkout.country")}</span>
                {/* Eén bezorgland → geen keuzelijst met één optie, maar de naam. */}
                {countries.length > 1 ? (
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="mt-1 w-full border border-line bg-canvas px-4 py-2 font-sans text-sm focus:border-ink focus:outline-none"
                  >
                    {countries.map((z) => (
                      <option key={z.code} value={z.code}>{z.label}</option>
                    ))}
                  </select>
                ) : (
                  <span className="mt-1 block font-sans text-sm text-ink-soft">{zone.label}</span>
                )}
                {/* Tarief + gratis-drempel van het gekozen land — dezelfde
                    DHL-staffel die de server rekent. */}
                <span className="mt-1 block font-sans text-xs text-muted">
                  {zone.freeFromCents !== null
                    ? t("checkout.shipping_rate_free_from", {
                        amount: formatEuro(country === DEFAULT_COUNTRY ? shipCents : zone.rateCents),
                        threshold: formatEuro(country === DEFAULT_COUNTRY ? freeShipCents : zone.freeFromCents),
                      })
                    : t("checkout.shipping_rate_flat", { amount: formatEuro(zone.rateCents) })}
                </span>
              </label>
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
                country={country}
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

          {/* Betaalmethode vooraf — geen tussenstop meer op Mollie's keuzescherm.
              Alleen de kopgroep (per land instelbaar) krijgt een knop; al het
              andere zit onder één regel "Overige betaalmethoden" die zónder
              gekozen methode naar Mollie gaat — dáár staat de volledige lijst. */}
          {payableCents > 0 && payVisible.length ? (
            <>
              {/* Exposure pas hier: wie de betaalstap nooit haalde heeft de proef
                  niet gezien en hoort niet in de noemer van de conversie. */}
              {pay.ab.length ? <TrackAb assignments={pay.ab} /> : null}
              <p className="label-brand mt-4">{t("checkout.payment_method")}</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {payVisible.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => { payTouched.current = true; setPayMethod(m.id); }}
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
              {payRest.length ? (
                <button
                  type="button"
                  onClick={() => { payTouched.current = true; setPayMethod(""); }}
                  aria-pressed={payMethod === ""}
                  className={`mt-2 flex w-full items-center gap-2.5 rounded-card border px-3 py-2.5 text-left font-sans text-sm transition-colors ${payMethod === "" ? "border-ink bg-surface" : "border-line hover:border-ink"}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block">{t("checkout.payment_other")}</span>
                    {/* Afbreken over twee regels, NIET truncate. `truncate` zet
                        white-space:nowrap, en die min-content (hier ruim 600px
                        aan methodenamen) duwt de hele checkout-grid open: op een
                        telefoon van 375px werd de pagina 704px breed en liep
                        álles buiten beeld. Klemmen op twee regels toont boven-
                        dien meer dan een afgekapt "PayPal · Bancon…". */}
                    <span className="mt-0.5 block overflow-hidden text-xs leading-snug text-muted [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]">
                      {payRest.map((m) => m.description).join(" · ")}
                    </span>
                  </span>
                </button>
              ) : null}
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
              {/* Nieuw tabblad: wegnavigeren wiste hier de complete checkout-invoer. */}
              {t("checkout.agree_terms")} <a href="/pages/algemene-voorwaarden" target="_blank" rel="noopener" className="text-ink underline">{t("common.terms_link")}</a> {t("checkout.and_the")}{" "}
              <a href="/retourneren" target="_blank" rel="noopener" className="text-ink underline">{t("common.withdrawal_link")}</a> {t("checkout.withdrawal_note")}
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

          {/* Slotje = "veilig", draaiend rondje = "er gebeurt iets". Zonder die
              tweede stond de knop na de klik seconden lang stil terwijl de order
              werd aangemaakt, en klikten mensen nog eens. */}
          <button type="submit" disabled={busy} aria-busy={busy} className="btn-primary mt-4 w-full">
            {busy ? (
              <>
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 animate-spin" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.3" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
                {t("common.processing")}
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <rect x="4.5" y="10.5" width="15" height="10" rx="1.5" />
                  <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" strokeLinecap="round" />
                </svg>
                {payableCents === 0
                  ? t("checkout.complete_with_giftcard")
                  : `${t("checkout.pay_securely")} ${formatEuro(payableCents)}`}
              </>
            )}
          </button>
          {/* Geen FooterPayments-strip hier: die chips zijn wit-op-wit buiten de
              donkere footer, en de gekozen methode staat al in het betaalgrid. */}
          <p className="mt-3 font-sans text-xs text-muted">
            {payableCents === 0
              ? t("checkout.giftcard_covers_full")
              : `${t("checkout.payment_via")} ${payMethod ? methods.find((m) => m.id === payMethod)?.description || "Mollie" : t("checkout.payment_other_via")} · ${t("checkout.payment_note")}`}
          </p>
          </>
          )}
        </form>

        {/* Overzicht — op mobiel als inklapbaar blok bóven het formulier, zodat de
            bezorgkeuze en het kortingscode-veld vóór de betaalknop zichtbaar zijn. */}
        <aside className="order-first min-w-0 lg:order-none lg:sticky lg:top-20 lg:h-fit">
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
                    country={country}
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
