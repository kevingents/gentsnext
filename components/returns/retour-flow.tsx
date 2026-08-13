"use client";

import { useEffect, useRef, useState } from "react";
import { formatEuro } from "@/lib/format";
import { useT } from "@/components/i18n/locale-provider";
import { RETURN_REASONS, returnReason } from "@/lib/retour-redenen";
import { track } from "@/lib/track-client";

type Line = { orderLineId: string; sku: string; title: string; size: string; color: string; unitPriceCents: number; orderedQty: number; returnableQty: number };
type Policy = { windowDays: number; dhlReturnCostCents: number; freeOnCredit: boolean };
type Created = {
  ok: boolean; id?: string; status?: string; itemsCents?: number; shippingCostCents?: number;
  refundType?: "money" | "credit"; method?: "dhl" | "store"; labelPending?: boolean;
  label?: { url: string; base64: string; tracking: string } | null; error?: string;
};

const euro = formatEuro;
function nlDatum(iso: string): string {
  try {
    return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
  } catch {
    return iso;
  }
}
// Huisstijl-tokens (rounded-card/danger/success) — geen rauwe paletkleuren, zodat
// de retourflow visueel aansluit op checkout en PDP.
const inputCls = "w-full rounded-card border border-line px-3 py-2.5 text-base text-ink outline-none focus:border-ink";

type Prefill = { orderNumber: string; email: string; lines: Line[]; policy: Policy; withinWindow: boolean };
/** Retourneerbare bestellingen van de ingelogde klant — kiezen i.p.v. intikken. */
type MineOrder = { orderNumber: string; createdAt: string; totalCents: number; items: number; titles: string[] };

export function RetourFlow({ initialOrder = "", prefill, mine = [], stores = [] }: { initialOrder?: string; prefill?: Prefill | null; mine?: MineOrder[]; stores?: string[] }) {
  const t = useT();
  // Ingelogd vanaf de bestelpagina (prefill) → direct naar de artikelkeuze, géén e-mail nodig.
  const authed = Boolean(prefill);
  const [step, setStep] = useState<"lookup" | "select" | "done">(prefill ? "select" : "lookup");
  const [orderNumber, setOrderNumber] = useState(prefill?.orderNumber ?? initialOrder);
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [lines, setLines] = useState<Line[]>(prefill?.lines ?? []);
  const [policy, setPolicy] = useState<Policy | null>(prefill?.policy ?? null);
  const [withinWindow, setWithinWindow] = useState(prefill?.withinWindow ?? true);
  const [qty, setQty] = useState<Record<string, number>>(prefill ? Object.fromEntries(prefill.lines.map((l) => [l.orderLineId, 0])) : {});
  const [method, setMethod] = useState<"dhl" | "store">("dhl");
  const [pickupStore, setPickupStore] = useState("");
  const [refundType, setRefundType] = useState<"money" | "credit">("credit");
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [result, setResult] = useState<Created | null>(null);

  const chosenReason = returnReason(reasonCode);
  const noteRequired = Boolean(chosenReason?.needsNote);
  const reasonComplete = Boolean(chosenReason) && (!noteRequired || reasonNote.trim().length > 0);
  const showAlteration = Boolean(chosenReason?.alteration);

  /* Meten of de vermaak-hint iets uithaalt: hoe vaak zag een klant 'm (per reden)
     en hoe vaak klikte hij door naar een pasafspraak. Zonder het toon-event weet
     je alleen hoeveel afspraken er kwamen, niet hoeveel kansen er waren. Eén keer
     per reden per sessie — anders telt heen-en-weer klikken als losse kansen. */
  const hintSeen = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!showAlteration || hintSeen.current.has(reasonCode)) return;
    hintSeen.current.add(reasonCode);
    track("retour_vermaak_getoond", { handle: reasonCode, path: "/retourneren" });
  }, [showAlteration, reasonCode]);

  async function lookup() {
    setErr(""); setBusy(true);
    try {
      const r = await fetch("/api/returns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "lookup", orderNumber, email }) });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || t("retourneren.flow.error.notFound"));
      const retLines = (d.lines as Line[]).filter((l) => l.returnableQty > 0);
      if (!retLines.length) throw new Error(t("retourneren.flow.error.nothingReturnable"));
      setLines(retLines); setPolicy(d.policy); setWithinWindow(d.withinWindow);
      setQty(Object.fromEntries(retLines.map((l) => [l.orderLineId, 0])));
      setStep("select");
    } catch (e) { setErr(e instanceof Error ? e.message : t("retourneren.flow.error.generic")); } finally { setBusy(false); }
  }

  const selected = lines.filter((l) => (qty[l.orderLineId] || 0) > 0);
  const itemsCents = selected.reduce((s, l) => s + (qty[l.orderLineId] || 0) * l.unitPriceCents, 0);
  const free = method === "store" || (refundType === "credit" && (policy?.freeOnCredit ?? true));
  const shipCost = free ? 0 : policy?.dhlReturnCostCents ?? 0;

  async function submit() {
    setErr("");
    if (method === "store" && stores.length && !pickupStore) { setErr(t("retourneren.flow.error.chooseStore")); return; }
    if (!chosenReason) { setErr(t("retourneren.flow.error.chooseReason")); return; }
    if (noteRequired && !reasonNote.trim()) { setErr(t("retourneren.flow.error.needNote")); return; }
    setBusy(true);
    try {
      const items = selected.map((l) => ({ orderLineId: l.orderLineId, qty: qty[l.orderLineId] }));
      const r = await fetch("/api/returns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", orderNumber, email, items, method, refundType, reasonCode, reasonNote, pickupStore: method === "store" ? pickupStore : "" }) });
      const d = (await r.json()) as Created;
      if (!r.ok || !d.ok) throw new Error(d.error || t("retourneren.flow.error.createFailed"));
      // De noemer onder de vermaak-hint: hoeveel retouren gingen er tóch door?
      track("retour_aangemeld", { handle: reasonCode, valueCents: itemsCents, path: "/retourneren" });
      setResult(d); setStep("done");
    } catch (e) { setErr(e instanceof Error ? e.message : t("retourneren.flow.error.generic")); } finally { setBusy(false); }
  }

  /* ── Stap 1: opzoeken ───────────────────────────────────────────── */
  if (step === "lookup") {
    return (
      <div className="space-y-6">
        {/* Ingelogd: kiezen uit je eigen bestellingen. Wie al bewezen heeft wie hij
            is, hoort geen bestelnummer en e-mailadres te hoeven opzoeken op het
            moment dat hij iets wil terugsturen. */}
        {mine.length > 0 && (
          <section>
            <p className="label-brand mb-2">{t("retourneren.flow.chooseOwnOrder")}</p>
            <div className="space-y-2">
              {mine.map((o) => (
                <a
                  key={o.orderNumber}
                  href={`/retourneren?order=${encodeURIComponent(o.orderNumber)}`}
                  className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-3 py-2.5 hover:border-ink"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{t("account.orderNumber", { n: o.orderNumber })}</span>
                    <span className="block truncate text-xs text-ink-soft">
                      {nlDatum(o.createdAt)} · {euro(o.totalCents)} · {o.titles.join(", ")}
                    </span>
                  </span>
                  <span aria-hidden className="shrink-0 text-ink-soft">→</span>
                </a>
              ))}
            </div>
          </section>
        )}

        <div className="space-y-4">
          <p className="font-sans text-ink-soft">
            {mine.length > 0 ? t("retourneren.flow.introOtherOrder") : t("retourneren.flow.introLookup")}
          </p>
        <div className="grid gap-3 sm:max-w-md">
          <input className={inputCls} placeholder={t("retourneren.flow.orderNumberPlaceholder")} value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
          <input className={inputCls} placeholder={t("retourneren.flow.emailPlaceholder")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {err && <p className="text-sm text-danger">{err}</p>}
          <button onClick={lookup} disabled={busy || !orderNumber || !email} className="btn-primary disabled:opacity-50">{busy ? t("retourneren.flow.searching") : t("retourneren.flow.findOrder")}</button>
        </div>
        </div>
      </div>
    );
  }

  /* ── Stap 2: kiezen ─────────────────────────────────────────────── */
  if (step === "select") {
    return (
      <div className="space-y-5">
        {/* Eerlijk zijn: createReturn() WEIGERT buiten de termijn. De oude tekst
            ("je kunt het wel proberen, we beoordelen per geval") nodigde uit tot
            een poging die de server daarna afkapt — dat is de vervelendste manier
            om nee te horen. */}
        {!withinWindow && (
          <div className="rounded-card border border-line bg-surface px-3 py-2 text-sm text-ink-soft">
            {t("retourneren.flow.windowExpired", { days: policy?.windowDays ?? "" })}
          </div>
        )}

        <section>
          <p className="label-brand mb-2">{t("retourneren.flow.whichItems")}</p>
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.orderLineId} className="flex items-center gap-3 rounded-card border border-line bg-surface px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{l.title}</p>
                  <p className="text-xs text-ink-soft">{[l.color, l.size].filter(Boolean).join(" · ")} · {euro(l.unitPriceCents)}</p>
                </div>
                <select value={qty[l.orderLineId] || 0} onChange={(e) => setQty((p) => ({ ...p, [l.orderLineId]: Number(e.target.value) }))} className="rounded-card border border-line px-2 py-1.5 text-base text-ink">
                  {Array.from({ length: l.returnableQty + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
            ))}
          </div>
        </section>

        {/* Reden staat bewust VÓÓR de methode-keuze: pas als iemand "te groot" of
            "mouwlengte" aantikt kunnen we vermaken aanbieden, en dat aanbod komt
            te laat als hij dan al een retourlabel heeft gekozen. Verplicht, want
            optioneel bleef het leeg — en daarmee bleef ook het pasvorm-signaal in
            het dashboard leeg. */}
        <section>
          <p className="label-brand mb-1">{t("retourneren.flow.whyReturn")}</p>
          <p className="mb-2 font-sans text-xs text-ink-soft">{t("retourneren.flow.whySub")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {RETURN_REASONS.map((r) => (
              <button
                key={r.code}
                type="button"
                aria-pressed={reasonCode === r.code}
                onClick={() => setReasonCode(r.code)}
                className={`rounded-card border px-4 py-3 text-left text-sm text-ink ${reasonCode === r.code ? "border-ink bg-ink/5 font-semibold" : "border-line"}`}
              >
                {t(r.key)}
              </button>
            ))}
          </div>

          {/* Vermaken is een BETAALDE service — nooit als gratis presenteren. */}
          {showAlteration && (
            <div className="mt-2 rounded-card border border-line bg-surface px-4 py-3">
              <p className="text-sm font-semibold text-ink">{t("retourneren.flow.alterationTitle")}</p>
              <p className="mt-1 font-sans text-sm text-ink-soft">{t("retourneren.flow.alterationBody")}</p>
              {/* Nieuw tabblad: wie het aanbod gaat bekijken is z'n retour nog niet
                  kwijt. Weggenavigeer je hem, dan is de hele artikelkeuze weg en
                  begint hij straks opnieuw — of hij haakt af. */}
              <a
                href="/afspraak"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track("retour_vermaak_klik", { handle: reasonCode, path: "/retourneren" })}
                className="mt-2 inline-block text-sm font-medium text-ink underline underline-offset-4"
              >
                {t("retourneren.flow.alterationCta")}
              </a>
            </div>
          )}

          <label className="mt-2 block">
            <span className="font-sans text-xs text-ink-soft">
              {noteRequired ? t("retourneren.flow.noteRequired") : t("retourneren.flow.noteOptional")}
            </span>
            <textarea
              className={`${inputCls} mt-1`}
              rows={2}
              placeholder={noteRequired ? t("retourneren.flow.notePlaceholderRequired") : t("retourneren.flow.notePlaceholder")}
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
            />
          </label>
        </section>

        <section>
          <p className="label-brand mb-2">{t("retourneren.flow.howReturn")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button onClick={() => setMethod("dhl")} className={`rounded-card border px-4 py-3 text-left ${method === "dhl" ? "border-ink bg-ink/5" : "border-line"}`}>
              <span className="block text-sm font-semibold text-ink">{t("retourneren.flow.methodDhl")}</span>
              <span className="block text-xs text-ink-soft">{t("retourneren.flow.methodDhlSub")}</span>
            </button>
            <button onClick={() => setMethod("store")} className={`rounded-card border px-4 py-3 text-left ${method === "store" ? "border-ink bg-ink/5" : "border-line"}`}>
              <span className="block text-sm font-semibold text-ink">{t("retourneren.flow.methodStore")}</span>
              <span className="block text-xs text-ink-soft">{t("retourneren.flow.methodStoreSub")}</span>
            </button>
          </div>
          {method === "store" && stores.length ? (
            <label className="mt-2 block">
              <span className="font-sans text-xs text-ink-soft">{t("retourneren.flow.whichStore")}</span>
              <select value={pickupStore} onChange={(e) => setPickupStore(e.target.value)} className={`${inputCls} mt-1`}>
                <option value="">{t("retourneren.flow.chooseStore")}</option>
                {stores.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          ) : null}
        </section>

        <section>
          <p className="label-brand mb-2">{t("retourneren.flow.whatBack")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button onClick={() => setRefundType("credit")} className={`rounded-card border px-4 py-3 text-left ${refundType === "credit" ? "border-ink bg-ink/5" : "border-line"}`}>
              <span className="block text-sm font-semibold text-ink">{t("retourneren.flow.refundCredit")}</span>
              <span className="block text-xs text-ink-soft">{t("retourneren.flow.refundCreditSub", { amount: euro(itemsCents) })}</span>
            </button>
            <button onClick={() => setRefundType("money")} className={`rounded-card border px-4 py-3 text-left ${refundType === "money" ? "border-ink bg-ink/5" : "border-line"}`}>
              <span className="block text-sm font-semibold text-ink">{t("retourneren.flow.refundMoney")}</span>
              <span className="block text-xs text-ink-soft">{t("retourneren.flow.refundMoneySub")}{!free && policy ? ` ${t("retourneren.flow.refundMoneyCost", { amount: euro(policy.dhlReturnCostCents) })}` : ""}</span>
            </button>
          </div>
        </section>

        <div className="rounded-card border border-line bg-surface px-4 py-3 text-sm">
          <div className="flex justify-between text-ink-soft"><span>{t("retourneren.flow.itemsValue")}</span><span>{euro(itemsCents)}</span></div>
          <div className="flex justify-between text-ink-soft"><span>{t("retourneren.flow.returnCost")}</span><span>{shipCost === 0 ? t("retourneren.flow.free") : `− ${euro(shipCost)}`}</span></div>
          <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold text-ink"><span>{refundType === "credit" ? t("retourneren.flow.creditLabel") : t("retourneren.flow.refundLabel")}</span><span>{euro(refundType === "credit" ? itemsCents : Math.max(0, itemsCents - shipCost))}</span></div>
        </div>

        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex gap-2">
          {authed ? (
            <a href="/account" className="btn-ghost">{t("retourneren.flow.back")}</a>
          ) : (
            <button onClick={() => setStep("lookup")} className="btn-ghost">{t("retourneren.flow.back")}</button>
          )}
          <button onClick={submit} disabled={busy || !selected.length || !reasonComplete} className="btn-primary disabled:opacity-50">{busy ? t("retourneren.flow.busy") : t("retourneren.flow.confirm")}</button>
        </div>
      </div>
    );
  }

  /* ── Stap 3: bevestiging ────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      <div className="rounded-card border border-success/40 bg-success/5 px-4 py-3 text-sm text-success">
        {t("retourneren.flow.registered")}{result?.refundType === "credit" ? ` ${t("retourneren.flow.registeredCredit")}` : "."}
      </div>

      {result?.method === "dhl" && (
        result.label && (result.label.base64 || result.label.url) ? (
          <div className="space-y-2">
            <p className="text-sm text-ink-soft">{t("retourneren.flow.printLabel")}</p>
            {result.label.base64
              ? <a href={`data:application/pdf;base64,${result.label.base64}`} download={`retourlabel-${orderNumber}.pdf`} className="btn-primary inline-block">{t("retourneren.flow.downloadLabel")}</a>
              : <a href={result.label.url} target="_blank" rel="noopener noreferrer" className="btn-primary inline-block">{t("retourneren.flow.openLabel")}</a>}
            {result.label.tracking && <p className="text-xs text-ink-soft">{t("retourneren.flow.trackTrace")} {result.label.tracking}</p>}
          </div>
        ) : (
          <p className="text-sm text-ink-soft">{t("retourneren.flow.labelByEmail")}</p>
        )
      )}

      {result?.method === "store" && (
        <p className="text-sm text-ink-soft">{t("retourneren.flow.storeInstruction1")} <strong className="text-ink">{pickupStore || t("retourneren.flow.anyStore")}</strong>. {t("retourneren.flow.storeInstruction2")}</p>
      )}

      <button onClick={() => { setStep("lookup"); setResult(null); setOrderNumber(""); setEmail(""); setReasonCode(""); setReasonNote(""); }} className="btn-ghost">{t("account.returns.new")}</button>
    </div>
  );
}
