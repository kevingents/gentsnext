"use client";

import Link from "next/link";
import { useState } from "react";
import {
  recommendSizes,
  type FitPreference,
  type SizeAdvice,
  type CategoryAdvice,
} from "@/lib/sizing";

const FITS: { key: FitPreference; label: string; hint: string }[] = [
  { key: "slim", label: "Slim", hint: "Strak, modern silhouet" },
  { key: "regular", label: "Modern", hint: "Comfortabel, niet te wijd" },
  { key: "comfort", label: "Comfort", hint: "Ruimer, meer bewegingsvrijheid" },
];

const CONFIDENCE_LABEL: Record<CategoryAdvice["confidence"], string> = {
  hoog: "Betrouwbaar advies",
  gemiddeld: "Goede inschatting",
  laag: "Globale inschatting",
};

function num(v: string): number | undefined {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function AdviceCard({ title, advice, shopHref }: { title: string; advice: CategoryAdvice; shopHref?: string }) {
  return (
    <div className="border border-line bg-canvas p-5">
      <p className="label-brand">{title}</p>
      <p className="mt-2 font-display text-4xl font-light text-ink">
        {advice.range ?? advice.size}
      </p>
      <p className="mt-1 font-sans text-xs text-muted">{CONFIDENCE_LABEL[advice.confidence]}</p>
      {advice.note ? (
        <p className="mt-3 font-sans text-sm leading-relaxed text-ink-soft">{advice.note}</p>
      ) : null}
      {shopHref ? (
        <Link
          href={shopHref}
          className="mt-4 inline-block font-sans text-sm text-ink underline underline-offset-4"
        >
          Shop in deze maat
        </Link>
      ) : null}
    </div>
  );
}

export function SizeAdvisor() {
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [fit, setFit] = useState<FitPreference>("regular");
  const [showMeasured, setShowMeasured] = useState(false);
  const [chest, setChest] = useState("");
  const [waist, setWaist] = useState("");
  const [neck, setNeck] = useState("");
  const [advice, setAdvice] = useState<SizeAdvice | null>(null);
  const [error, setError] = useState("");

  const heightCm = num(height);
  const weightKg = num(weight);
  const ready = Boolean(heightCm && weightKg);

  function calculate() {
    if (!heightCm || !weightKg) {
      setError("Vul je lengte en gewicht in om een advies te krijgen.");
      return;
    }
    if (heightCm < 140 || heightCm > 215 || weightKg < 45 || weightKg > 180) {
      setError("Controleer je lengte en gewicht — die lijken buiten het verwachte bereik.");
      return;
    }
    setError("");
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
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="font-sans text-sm font-medium text-ink">Lengte (cm)</span>
            <input
              inputMode="numeric"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              placeholder="bijv. 182"
              className="mt-2 w-full border border-line bg-canvas px-4 py-3 font-sans text-sm focus:border-ink focus:outline-none"
              aria-label="Lengte in centimeters"
            />
          </label>
          <label className="block">
            <span className="font-sans text-sm font-medium text-ink">Gewicht (kg)</span>
            <input
              inputMode="numeric"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="bijv. 80"
              className="mt-2 w-full border border-line bg-canvas px-4 py-3 font-sans text-sm focus:border-ink focus:outline-none"
              aria-label="Gewicht in kilogram"
            />
          </label>
        </div>

        <fieldset>
          <legend className="font-sans text-sm font-medium text-ink">Pasvorm-voorkeur</legend>
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
                <span className="block font-sans text-sm font-medium">{f.label}</span>
                <span
                  className={`mt-0.5 block font-sans text-xs ${fit === f.key ? "text-canvas/70" : "text-muted"}`}
                >
                  {f.hint}
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
            {showMeasured ? "Verberg lichaamsmaten" : "Ik weet mijn lichaamsmaten (nauwkeuriger)"}
          </button>
          {showMeasured ? (
            <div className="mt-4 grid grid-cols-3 gap-4">
              {[
                { label: "Borst (cm)", value: chest, set: setChest },
                { label: "Taille (cm)", value: waist, set: setWaist },
                { label: "Hals (cm)", value: neck, set: setNeck },
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
          Toon mijn maat
        </button>
        <p className="font-sans text-xs leading-relaxed text-muted">
          Dit advies is een inschatting op basis van je gegevens. Twijfel je tussen
          twee maten? Onze stylisten in de winkel helpen je graag verder.
        </p>
      </form>

      {/* ── Resultaat ──────────────────────────────────────────────── */}
      <div className="lg:border-l lg:border-line lg:pl-10">
        {advice ? (
          <div className="space-y-4">
            <div>
              <p className="label-brand">Jouw maatadvies</p>
              <p className="mt-1 font-sans text-sm text-ink-soft">
                Geschatte borstomvang ± {advice.estimatedChestCm} cm
                {advice.tall ? " · lange lengte" : ""}
              </p>
            </div>
            <AdviceCard title="Colbert / pak" advice={advice.jacket} shopHref="/collections/colberts" />
            {advice.trouserLength ? (
              <AdviceCard title="Lengtemaat (lang)" advice={advice.trouserLength} shopHref="/collections/broeken" />
            ) : null}
            <AdviceCard title="Overhemd (boordmaat)" advice={advice.shirt} shopHref="/collections/overhemden" />
          </div>
        ) : (
          <div className="flex h-full flex-col justify-center border border-dashed border-line p-8 text-center">
            <p className="font-display text-xl font-light text-ink">Jouw advies verschijnt hier</p>
            <p className="mt-2 font-sans text-sm text-muted">
              Vul je gegevens in en we berekenen je colbert-, lengte- en boordmaat.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
