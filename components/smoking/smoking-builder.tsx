"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useCart } from "@/components/cart/cart-context";
import { SizeMatrix } from "@/components/pdp/size-matrix";
import { formatEuro } from "@/lib/pricing";
import { SMOKING_ROLES, smokingGroupId, type SmokingRole } from "@/lib/smoking-korting";
import type { SmokingNiveau, SmokingOptie, SmokingPakket } from "@/lib/smoking-pakket";

/**
 * "Smoking compleet" — de klant kiest zelf zijn jas (punt- of shawlkraag),
 * pantalon, overhemd en strik, elk in zijn eigen maat, tegen één vaste
 * pakketprijs.
 *
 * De vier delen gaan als ECHTE losse artikelen naar de winkelwagen, met een
 * gedeelde groupId. Daardoor blijft de voorraad kloppen en ziet het magazijn
 * vier gewone pickregels; de vaste prijs wordt bij het afrekenen server-side
 * verrekend (lib/smoking-korting.ts). Nooit alleen hier in de weergave — dan
 * zou de klant een prijs zien die de order niet kent.
 */

/* roleLabel is niet alleen een bijschrift: de kortingsberekening herkent er de
   vier kernonderdelen aan. Daarom precies deze woorden, en niet "Smokingjas". */
const ROL_LABEL: Record<SmokingRole, string> = {
  jas: "Jas",
  broek: "Broek",
  overhemd: "Overhemd",
  strik: "Strik",
};

const ROL_HG: Record<SmokingRole, string> = {
  jas: "Colberts",
  broek: "Broeken",
  overhemd: "Overhemden",
  strik: "Strikken",
};

type Keuze = { handle: string; size: string | null };

export function SmokingBuilder({ pakket }: { pakket: SmokingPakket }) {
  const cart = useCart();
  const [niveauId, setNiveauId] = useState(pakket.niveaus[0]!.id);
  const [keuzes, setKeuzes] = useState<Partial<Record<SmokingRole, Keuze>>>({});
  const [extras, setExtras] = useState<Record<string, string | null>>({});
  const [bezig, setBezig] = useState(false);

  const niveau = useMemo(
    () => pakket.niveaus.find((n) => n.id === niveauId) ?? pakket.niveaus[0]!,
    [pakket.niveaus, niveauId]
  );

  /** Enige leverbare maat meteen kiezen — een klik zonder alternatief is een drempel. */
  function enigeMaat(optie: SmokingOptie): string | null {
    const leverbaar = optie.sizes.filter((s) => !s.known || s.qty > 0);
    return leverbaar.length === 1 ? leverbaar[0]!.size : null;
  }

  function kiesNiveau(id: string) {
    if (id === niveauId) return;
    setNiveauId(id);
    setKeuzes({}); // een wollen jas hoort niet bij het polyviscose-pakket
  }

  function kiesOptie(rol: SmokingRole, optie: SmokingOptie) {
    setKeuzes((prev) => {
      const vorige = prev[rol];
      /* Maat vasthouden bij het wisselen van model: wie van punt- naar
         shawlkraag klikt is nog steeds maat 50 — mits die daar leverbaar is. */
      const behoud =
        vorige?.size && optie.sizes.some((s) => s.size === vorige.size && (!s.known || s.qty > 0))
          ? vorige.size
          : enigeMaat(optie);
      return { ...prev, [rol]: { handle: optie.handle, size: behoud } };
    });
  }

  function kiesMaat(rol: SmokingRole, size: string) {
    setKeuzes((prev) => (prev[rol] ? { ...prev, [rol]: { ...prev[rol]!, size } } : prev));
  }

  const optieVan = (rol: SmokingRole): SmokingOptie | null => {
    const rij = niveau.rollen.find((r) => r.rol === rol);
    const handle = keuzes[rol]?.handle;
    return (handle && rij?.opties.find((o) => o.handle === handle)) || null;
  };

  const variantVan = (rol: SmokingRole) => {
    const optie = optieVan(rol);
    const size = keuzes[rol]?.size;
    return optie && size ? optie.sizes.find((s) => s.size === size) ?? null : null;
  };

  const losseSomCents = SMOKING_ROLES.reduce((som, rol) => som + (variantVan(rol)?.priceCents ?? 0), 0);
  const kernCompleet = SMOKING_ROLES.every((rol) => {
    const v = variantVan(rol);
    return v && (!v.known || v.qty > 0);
  });

  const extrasGekozen = Object.entries(extras)
    .map(([handle, size]) => {
      const optie = pakket.extras.find((e) => e.handle === handle);
      const variant = optie && size ? optie.sizes.find((s) => s.size === size) ?? null : null;
      return optie ? { optie, size, variant } : null;
    })
    .filter(Boolean) as { optie: SmokingPakket["extras"][number]; size: string | null; variant: SmokingOptie["sizes"][number] | null }[];

  /* Een aangevinkte extra zonder maat mag de bestelling niet in: die zou stil
     uit de mand vallen terwijl hij wél in het overzicht stond. */
  const extrasCompleet = extrasGekozen.every((e) => e.variant && (!e.variant.known || e.variant.qty > 0));
  const extrasCents = extrasGekozen.reduce((som, e) => som + (e.variant?.priceCents ?? 0), 0);
  const besparing = kernCompleet ? Math.max(0, losseSomCents - niveau.prijsCents) : 0;
  const kanToevoegen = kernCompleet && extrasCompleet && !bezig;

  const nogTeKiezen = [
    ...SMOKING_ROLES.filter((rol) => !variantVan(rol)).map((rol) => ROL_LABEL[rol].toLowerCase()),
    ...extrasGekozen.filter((e) => !e.variant).map((e) => e.optie.label.toLowerCase()),
  ];

  function voegToe() {
    if (!kanToevoegen) return;
    setBezig(true);
    const groupId = smokingGroupId(niveau.id, Math.random().toString(36).slice(2, 10));
    const groupLabel = `Smoking compleet — ${niveau.naam}`;

    const regels = SMOKING_ROLES.map((rol) => {
      const optie = optieVan(rol)!;
      const variant = variantVan(rol)!;
      return {
        sku: variant.sku,
        productHandle: optie.handle,
        title: optie.title,
        size: variant.size,
        color: optie.kleur,
        priceCents: variant.priceCents,
        imageUrl: optie.image,
        qty: 1,
        hoofdgroep: ROL_HG[rol],
        groupId,
        groupLabel,
        roleLabel: ROL_LABEL[rol],
      };
    });

    /* Extra's krijgen dezelfde groupId zodat ze bij elkaar blijven staan in de
       wagen, maar een eigen roleLabel — ze tellen niet mee in de pakketprijs. */
    for (const e of extrasGekozen) {
      if (!e.variant) continue;
      regels.push({
        sku: e.variant.sku,
        productHandle: e.optie.handle,
        title: e.optie.title,
        size: e.variant.size,
        color: e.optie.kleur,
        priceCents: e.variant.priceCents,
        imageUrl: e.optie.image,
        qty: 1,
        hoofdgroep: "Accessoires",
        groupId,
        groupLabel,
        roleLabel: "Extra",
      });
    }

    cart.addMany(regels);
    setBezig(false);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px] lg:items-start">
      <div className="flex flex-col gap-6">
        {/* Stof / niveau */}
        <section>
          <h2 className="font-sans text-sm font-semibold uppercase tracking-wider text-muted">
            <span className="mr-2 tabular-nums text-ink/40">1</span>Kies je stof
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {pakket.niveaus.map((n) => (
              <NiveauKaart key={n.id} niveau={n} actief={n.id === niveau.id} onKies={() => kiesNiveau(n.id)} />
            ))}
          </div>
        </section>

        {/* Per rol: eerst het artikel, dan METEEN de maat eronder. De maten in een
            aparte sectie onderaan zetten betekende: kies vier keer een model,
            scrol terug, kies vier keer een maat. Nu maak je één onderdeel in één
            keer af en zie je direct wat er nog open staat. */}
        {niveau.rollen.map((rij, i) => {
          const gekozenOptie = optieVan(rij.rol);
          const gekozenMaat = keuzes[rij.rol]?.size ?? null;
          return (
          <section key={rij.rol} className="border-t border-line pt-6">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-sans text-sm font-semibold uppercase tracking-wider text-muted">
                <span className="mr-2 tabular-nums text-ink/40">{i + 2}</span>
                {rij.label}
              </h2>
              <span className="font-sans text-xs text-muted">
                {gekozenMaat
                  ? `${gekozenOptie?.title ?? ""} · maat ${gekozenMaat}`
                  : gekozenOptie
                    ? "kies je maat"
                    : "inbegrepen in de pakketprijs"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {rij.opties.map((optie) => {
                const actief = keuzes[rij.rol]?.handle === optie.handle;
                return (
                  <button
                    key={optie.handle}
                    type="button"
                    onClick={() => kiesOptie(rij.rol, optie)}
                    aria-pressed={actief}
                    className={`overflow-hidden rounded-lg border text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                      actief ? "border-ink ring-2 ring-ink/15" : "border-line hover:border-ink/40"
                    }`}
                  >
                    {optie.image ? (
                      <Image
                        src={optie.image}
                        alt={optie.title}
                        width={300}
                        height={400}
                        className="aspect-[3/4] w-full object-cover"
                      />
                    ) : (
                      <div className="aspect-[3/4] w-full bg-surface" />
                    )}
                    <span className="block px-2.5 py-2">
                      <span className="block font-sans text-xs font-medium leading-snug">{optie.title}</span>
                      <span className="block font-sans text-[11px] text-muted">
                        {optie.kleur ? `${optie.kleur} · inbegrepen` : "Inbegrepen"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {gekozenOptie && (
              <div className="mt-4 rounded-lg bg-surface p-4">
                <p className="font-sans text-xs font-semibold uppercase tracking-wider text-muted">
                  Maat — {gekozenOptie.title}
                </p>
                <div className="mt-2">
                  <SizeMatrix
                    sizes={gekozenOptie.sizes}
                    hoofdgroep={ROL_HG[rij.rol]}
                    selected={gekozenMaat}
                    onSelect={(size) => kiesMaat(rij.rol, size)}
                  />
                </div>
              </div>
            )}
          </section>
          );
        })}

        {/* Extra's — buiten de pakketprijs */}
        {pakket.extras.length > 0 && (
          <section>
            <h2 className="font-sans text-sm font-semibold uppercase tracking-wider text-muted">
              Maak het af
            </h2>
            <p className="mt-1 font-sans text-sm text-muted">Optioneel, tegen de gewone prijs.</p>
            <div className="mt-3 flex flex-col gap-3">
              {pakket.extras.map((extra) => {
                const aan = Object.prototype.hasOwnProperty.call(extras, extra.handle);
                const vanaf = Math.min(...extra.sizes.map((s) => s.priceCents));
                return (
                  <div key={extra.handle} className="rounded-lg border border-line p-3">
                    <button
                      type="button"
                      onClick={() =>
                        setExtras((prev) => {
                          const next = { ...prev };
                          if (aan) delete next[extra.handle];
                          else next[extra.handle] = enigeMaat(extra);
                          return next;
                        })
                      }
                      aria-pressed={aan}
                      className="flex w-full items-center gap-3 text-left"
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                          aan ? "border-ink bg-ink text-canvas" : "border-line"
                        }`}
                        aria-hidden="true"
                      >
                        {aan ? "✓" : ""}
                      </span>
                      {extra.image ? (
                        <Image src={extra.image} alt="" width={44} height={56} className="h-14 w-11 rounded object-cover" />
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block font-sans text-sm font-medium">{extra.label}</span>
                        <span className="block font-sans text-xs text-muted">
                          {[extra.omschrijving || extra.title, extra.kleur].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="font-sans text-sm font-semibold tabular-nums">+ {formatEuro(vanaf)}</span>
                    </button>
                    {aan && extra.sizes.length > 1 && (
                      <div className="mt-3">
                        <SizeMatrix
                          sizes={extra.sizes}
                          hoofdgroep="Accessoires"
                          selected={extras[extra.handle] ?? null}
                          onSelect={(size) => setExtras((prev) => ({ ...prev, [extra.handle]: size }))}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* Samenvatting */}
      <aside className="rounded-lg border border-line p-5 lg:sticky lg:top-6">
        <h2 className="font-sans text-base font-semibold">Jouw smoking</h2>
        <ul className="mt-3 flex flex-col divide-y divide-line">
          {SMOKING_ROLES.map((rol) => {
            const optie = optieVan(rol);
            const variant = variantVan(rol);
            return (
              <li key={rol} className="flex items-center gap-3 py-2.5">
                {optie?.image ? (
                  <Image src={optie.image} alt="" width={36} height={46} className="h-11 w-9 rounded object-cover" />
                ) : (
                  <span className="h-11 w-9 rounded bg-surface" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-sans text-xs font-medium">
                    {optie?.title ?? ROL_LABEL[rol]}
                  </span>
                  <span className="block font-sans text-[11px] text-muted">
                    {variant ? `maat ${variant.size}` : optie ? "maat kiezen" : "nog kiezen"}
                  </span>
                </span>
              </li>
            );
          })}
          {extrasGekozen.map((e) => (
            <li key={e.optie.handle} className="flex items-center gap-3 py-2.5">
              {e.optie.image ? (
                <Image src={e.optie.image} alt="" width={36} height={46} className="h-11 w-9 rounded object-cover" />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-sans text-xs font-medium">{e.optie.label}</span>
                <span className="block font-sans text-[11px] text-muted">
                  {e.variant ? `maat ${e.variant.size} · ${formatEuro(e.variant.priceCents)}` : "maat kiezen"}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t border-line pt-4">
          {besparing > 0 && (
            <div className="flex items-baseline justify-between font-sans text-sm text-muted">
              <span>Los gekocht</span>
              <span className="line-through tabular-nums">{formatEuro(losseSomCents)}</span>
            </div>
          )}
          <div className="mt-1 flex items-baseline justify-between font-sans text-lg font-semibold">
            <span>Pakketprijs</span>
            <span className="tabular-nums">{formatEuro(niveau.prijsCents)}</span>
          </div>
          {extrasCents > 0 && (
            <>
              <div className="mt-1 flex items-baseline justify-between font-sans text-sm text-muted">
                <span>Extra&apos;s</span>
                <span className="tabular-nums">{formatEuro(extrasCents)}</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between font-sans text-lg font-semibold">
                <span>Totaal</span>
                <span className="tabular-nums">{formatEuro(niveau.prijsCents + extrasCents)}</span>
              </div>
            </>
          )}
        </div>

        {besparing > 0 && (
          <p className="mt-3 inline-block rounded bg-success/10 px-2 py-1 font-sans text-xs font-semibold text-success">
            Je bespaart {formatEuro(besparing)}
          </p>
        )}

        <button
          type="button"
          onClick={voegToe}
          disabled={!kanToevoegen}
          className="mt-4 h-12 w-full rounded-lg bg-ink font-sans text-sm font-semibold text-canvas transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pakket.knoptekst || "Voeg complete smoking toe"}
        </button>
        <p className="mt-3 font-sans text-xs text-muted">
          {kanToevoegen
            ? "Alle delen komen los in je winkelwagen — de pakketprijs wordt bij het afrekenen verrekend."
            : nogTeKiezen.length
              ? `Kies nog: ${nogTeKiezen.join(", ")}.`
              : "Kies per onderdeel een model en een maat."}
        </p>
      </aside>
    </div>
  );
}

function NiveauKaart({
  niveau,
  actief,
  onKies,
}: {
  niveau: SmokingNiveau;
  actief: boolean;
  onKies: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onKies}
      aria-pressed={actief}
      className={`relative rounded-lg border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
        actief ? "border-ink ring-2 ring-ink/15" : "border-line hover:border-ink/40"
      }`}
    >
      {niveau.badge && (
        <span className="absolute -top-2 right-3 rounded-full bg-ink px-2 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-canvas">
          {niveau.badge}
        </span>
      )}
      <span className="block font-sans text-sm font-semibold">{niveau.naam}</span>
      <span className="block min-h-[2.25rem] font-sans text-xs text-muted">{niveau.subtitel}</span>
      <span className="mt-1 block font-sans text-lg font-semibold tabular-nums">
        {formatEuro(niveau.prijsCents)}
      </span>
      <span className="block font-sans text-[11px] text-muted">compleet, 4 delen</span>
    </button>
  );
}
