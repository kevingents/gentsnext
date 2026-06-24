"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/i18n/locale-provider";
import {
  recommendSizes,
  type FitPreference,
  type SizeAdvice,
  type CategoryAdvice,
} from "@/lib/sizing";
import {
  REFERENCE_BRANDS,
  REFERENCE_LETTERS,
  referenceAdvice,
  type ReferenceBrand,
  type ReferenceLetter,
} from "@/lib/size-reference";

const FITS: { key: FitPreference; labelKey: string; hintKey: string }[] = [
  { key: "slim", labelKey: "sizeAdvisor.fit.slim", hintKey: "sizeAdvisor.fit.slimHint" },
  { key: "regular", labelKey: "sizeAdvisor.fit.modern", hintKey: "sizeAdvisor.fit.modernHint" },
  { key: "comfort", labelKey: "sizeAdvisor.fit.comfort", hintKey: "sizeAdvisor.fit.comfortHint" },
];

const CONFIDENCE_LABEL_KEY: Record<CategoryAdvice["confidence"], string> = {
  hoog: "sizeAdvisor.confidence.high",
  gemiddeld: "sizeAdvisor.confidence.medium",
  laag: "sizeAdvisor.confidence.low",
};

function num(v: string): number | undefined {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function AdviceCard({ title, advice, shopHref }: { title: string; advice: CategoryAdvice; shopHref?: string }) {
  const t = useT();
  return (
    <div className="border border-line bg-canvas p-5">
      <p className="label-brand">{title}</p>
      <p className="mt-2 font-display text-4xl font-light text-ink">
        {advice.range ?? advice.size}
      </p>
      <p className="mt-1 font-sans text-xs text-muted">{t(CONFIDENCE_LABEL_KEY[advice.confidence])}</p>
      {advice.note ? (
        <p className="mt-3 font-sans text-sm leading-relaxed text-ink-soft">{advice.note}</p>
      ) : null}
      {shopHref ? (
        <Link
          href={shopHref}
          className="mt-4 inline-block font-sans text-sm text-ink underline underline-offset-4"
        >
          {t("sizeAdvisor.shopInThisSize")}
        </Link>
      ) : null}
    </div>
  );
}

export function SizeAdvisor() {
  const t = useT();
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [fit, setFit] = useState<FitPreference>("regular");
  const [showMeasured, setShowMeasured] = useState(false);
  const [chest, setChest] = useState("");
  const [waist, setWaist] = useState("");
  const [neck, setNeck] = useState("");
  const [advice, setAdvice] = useState<SizeAdvice | null>(null);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "login" | "error">("idle");

  const heightCm = num(height);
  const weightKg = num(weight);
  const ready = Boolean(heightCm && weightKg);

  // Snelstart: bekende merkmaat → indicatief GENTS-advies (geen meting nodig).
  const [showRef, setShowRef] = useState(false);
  const [refBrand, setRefBrand] = useState<ReferenceBrand | "">("");
  const [refLetter, setRefLetter] = useState<ReferenceLetter | "">("");
  const refResult = refBrand && refLetter ? referenceAdvice(refBrand, refLetter, fit) : null;

  async function saveToProfile() {
    if (!advice) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/account/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "size",
          merge: true,
          sizeProfile: {
            colbert: advice.jacket.size,
            overhemd: advice.shirt.size,
            pasvorm: fit === "regular" ? "modern" : fit,
            lengte: heightCm ? String(heightCm) : "",
            gewicht: weightKg ? String(weightKg) : "",
          },
        }),
      });
      if (res.status === 401) {
        setSaveState("login");
        return;
      }
      setSaveState(res.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
  }

  function calculate() {
    if (!heightCm || !weightKg) {
      setError(t("sizeAdvisor.errorMissingData"));
      return;
    }
    if (heightCm < 140 || heightCm > 215 || weightKg < 45 || weightKg > 180) {
      setError(t("sizeAdvisor.errorOutOfRange"));
      return;
    }
    setError("");
    setSaveState("idle");
    setAdvice(
      recommendSizes({
        heightCm,
        weightKg,
        fit,
        chestCm: showMeasured ? num(chest) : undefined,
        waistCm: showMeasured ? num(waist) : undefined,
        neckCm: showMeasured ? num(neck) : undefined,
      })
    );
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ── Formulier ──────────────────────────────────────────────── */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          calculate();
        }}
        className="space-y-7"
        noValidate
      >
        {/* Snelstart: ken je je maat al bij een ander merk? */}
        <div className="border border-line bg-surface p-4">
          <button
            type="button"
            onClick={() => setShowRef((v) => !v)}
            aria-expanded={showRef}
            className="font-sans text-sm font-medium text-ink underline underline-offset-4"
          >
            {showRef ? t("sizeAdvisor.hideQuickStart") : t("sizeAdvisor.showQuickStart")}
          </button>
          {showRef ? (
            <div className="mt-4 space-y-4">
              <div>
                <span className="font-sans text-xs text-muted">{t("sizeAdvisor.brand")}</span>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {REFERENCE_BRANDS.map((b) => (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => setRefBrand(b.key)}
                      aria-pressed={refBrand === b.key}
                      className={`border px-3 py-1.5 font-sans text-sm transition-colors ${refBrand === b.key ? "border-ink bg-ink text-canvas" : "border-line bg-canvas hover:border-ink"}`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="font-sans text-xs text-muted">{t("sizeAdvisor.yourSizeThere")}</span>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {REFERENCE_LETTERS.map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setRefLetter(l)}
                      aria-pressed={refLetter === l}
                      className={`border px-3 py-1.5 font-sans text-sm transition-colors ${refLetter === l ? "border-ink bg-ink text-canvas" : "border-line bg-canvas hover:border-ink"}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              {refResult ? (
                <div className="border border-line bg-canvas p-4">
                  <p className="label-brand">{t("sizeAdvisor.gentsEstimate")}</p>
                  <dl className="mt-2 space-y-1 font-sans text-sm">
                    <div className="flex justify-between gap-4"><dt className="text-muted">{t("sizeAdvisor.jacket")}</dt><dd className="font-medium text-ink">{refResult.colbert.range ?? refResult.colbert.size}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted">{t("sizeAdvisor.shirt")}</dt><dd className="font-medium text-ink">{refResult.overhemd.size}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted">{t("sizeAdvisor.trousers")}</dt><dd className="font-medium text-ink">{refResult.broek.size}</dd></div>
                  </dl>
                  <p className="mt-3 font-sans text-xs leading-relaxed text-muted">
                    {t("sizeAdvisor.quickStartDisclaimer")}
                  </p>
                </div>
              ) : (
                <p className="font-sans text-xs text-muted">{t("sizeAdvisor.selectBrandAndSize")}</p>
              )}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="font-sans text-sm font-medium text-ink">{t("sizeAdvisor.height")}</span>
            <input
              inputMode="numeric"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              placeholder={t("sizeAdvisor.heightPlaceholder")}
              className="mt-2 w-full border border-line bg-canvas px-4 py-3 font-sans text-sm focus:border-ink focus:outline-none"
              aria-label={t("sizeAdvisor.heightAriaLabel")}
            />
          </label>
          <label className="block">
            <span className="font-sans text-sm font-medium text-ink">{t("sizeAdvisor.weight")}</span>
            <input
              inputMode="numeric"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder={t("sizeAdvisor.weightPlaceholder")}
              className="mt-2 w-full border border-line bg-canvas px-4 py-3 font-sans text-sm focus:border-ink focus:outline-none"
              aria-label={t("sizeAdvisor.weightAriaLabel")}
            />
          </label>
        </div>

        <fieldset>
          <legend className="font-sans text-sm font-medium text-ink">{t("sizeAdvisor.fitPreference")}</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {FITS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFit(f.key)}
                aria-pressed={fit === f.key}
                className={`border px-3 py-3 text-left transition-colors ${
                  fit === f.key ? "border-ink bg-ink text-canvas" : "border-line bg-canvas hover:border-ink"
                }`}
              >
                <span className="block font-sans text-sm font-medium">{t(f.labelKey)}</span>
                <span
                  className={`mt-0.5 block font-sans text-xs ${fit === f.key ? "text-canvas/70" : "text-muted"}`}
                >
                  {t(f.hintKey)}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <button
            type="button"
            onClick={() => setShowMeasured((v) => !v)}
            className="font-sans text-sm text-ink underline underline-offset-4"
            aria-expanded={showMeasured}
          >
            {showMeasured ? t("sizeAdvisor.hideMeasurements") : t("sizeAdvisor.showMeasurements")}
          </button>
          {showMeasured ? (
            <div className="mt-4 grid grid-cols-3 gap-4">
              {[
                { label: t("sizeAdvisor.chest"), value: chest, set: setChest },
                { label: t("sizeAdvisor.waist"), value: waist, set: setWaist },
                { label: t("sizeAdvisor.neck"), value: neck, set: setNeck },
              ].map((m) => (
                <label key={m.label} className="block">
                  <span className="font-sans text-xs text-muted">{m.label}</span>
                  <input
                    inputMode="numeric"
                    value={m.value}
                    onChange={(e) => m.set(e.target.value)}
                    className="mt-1 w-full border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none"
                    aria-label={m.label}
                  />
                </label>
              ))}
            </div>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="font-sans text-sm text-danger">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={!ready} className="btn-primary w-full">
          {t("sizeAdvisor.calculate")}
        </button>
        <p className="font-sans text-xs leading-relaxed text-muted">
          {t("sizeAdvisor.disclaimer")}
        </p>
      </form>

      {/* ── Resultaat ──────────────────────────────────────────────── */}
      <div className="lg:border-l lg:border-line lg:pl-10">
        {advice ? (
          <div className="space-y-4">
            <div>
              <p className="label-brand">{t("sizeAdvisor.yourAdvice")}</p>
              <p className="mt-1 font-sans text-sm text-ink-soft">
                {t("sizeAdvisor.estimatedChest")} {advice.estimatedChestCm} {t("sizeAdvisor.cmUnit")}
                {advice.tall ? ` · ${t("sizeAdvisor.tallNote")}` : ""}
              </p>
            </div>
            <AdviceCard title={t("sizeAdvisor.jacket")} advice={advice.jacket} shopHref="/collections/colberts" />
            {advice.trouserLength ? (
              <AdviceCard title={t("sizeAdvisor.adviceTrouserLength")} advice={advice.trouserLength} shopHref="/collections/broeken" />
            ) : null}
            <AdviceCard title={t("sizeAdvisor.adviceShirt")} advice={advice.shirt} shopHref="/collections/overhemden" />

            {/* Bewaar in profiel → daarna "Shop in jouw maat" overal op de site. */}
            <div className="border border-line bg-surface p-5">
              {saveState === "saved" ? (
                <div className="flex items-start gap-3">
                  <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-success" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5" /></svg>
                  <div>
                    <p className="font-sans text-sm font-medium text-ink">{t("sizeAdvisor.savedToProfile")}</p>
                    <p className="mt-1 font-sans text-xs text-ink-soft">
                      {t("sizeAdvisor.savedMessage")}
                    </p>
                    <Link href="/account" className="mt-2 inline-block font-sans text-xs text-ink underline underline-offset-4">{t("sizeAdvisor.viewMySizes")}</Link>
                  </div>
                </div>
              ) : saveState === "login" ? (
                <div className="flex items-start gap-3">
                  <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 11V7a4 4 0 10-8 0M5 11h14v10H5zM12 15v2" /></svg>
                  <div>
                    <p className="font-sans text-sm font-medium text-ink">{t("sizeAdvisor.loginToSave")}</p>
                    <p className="mt-1 font-sans text-xs text-ink-soft">{t("sizeAdvisor.loginMessage")}</p>
                    <Link href="/account/login?next=/maatadvies" className="mt-2 inline-block font-sans text-xs text-ink underline underline-offset-4">{t("sizeAdvisor.loginOrRegister")}</Link>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-sans text-sm text-ink-soft">
                    <span className="font-medium text-ink">{t("sizeAdvisor.saveSizeLabel")}</span> — {t("sizeAdvisor.saveSizeHint")}
                  </p>
                  <button
                    type="button"
                    onClick={saveToProfile}
                    disabled={saveState === "saving"}
                    className="btn-ghost shrink-0 !py-2"
                  >
                    {saveState === "saving" ? t("sizeAdvisor.saving") : t("sizeAdvisor.saveButton")}
                  </button>
                </div>
              )}
              {saveState === "error" ? (
                <p className="mt-2 font-sans text-xs text-danger">{t("sizeAdvisor.saveError")}</p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col justify-center border border-dashed border-line p-8 text-center">
            <p className="font-display text-xl font-light text-ink">{t("sizeAdvisor.emptyState")}</p>
            <p className="mt-2 font-sans text-sm text-muted">
              {t("sizeAdvisor.emptyStateDesc")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
