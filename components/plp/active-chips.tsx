"use client";

import { useRouter, usePathname } from "next/navigation";
import { useTransition } from "react";
import { buildPlpQuery, type PlpSelection } from "@/lib/plp-params";
import type { PlpStoreOption } from "@/lib/plp-store";
import { useT } from "@/components/i18n/locale-provider";
import { track } from "@/lib/track-client";
import { StoreChooser } from "@/components/stores/store-chooser";

/**
 * Actieve PERSOONLIJKE filters als chips, boven de resultaten.
 *
 * "Jouw maat" en "op voorraad in mijn winkel" zijn geen gewone filters: ze komen
 * uit het profiel van de klant en staan vaak al aan zonder dat 'ie ze zelf
 * aanzette. Ze stonden daarom als twee zware blokken bovenaan de filterkolom —
 * een zwart vlak ("Je ziet alleen jouw maat") en een omkaderde winkelkaart.
 *
 * Twee problemen daarmee (Kevin, 12 aug: "onduidelijk en te prominent"):
 *   1. Zwart is onze duurste kleur; die hoort bij het merk en bij de primaire
 *      actie, niet bij een mededeling. Een service las daardoor als waarschuwing.
 *   2. De winkelregel liet niet zien of 'ie aan of uit stond — er stond een naam
 *      met een getal, geen schakelaar.
 *
 * Chips zijn de standaardtaal voor "dit staat aan, klik om weg te halen": gevuld
 * = actief met een kruisje, omlijnd = een aanbod dat je kunt aanzetten. Ze staan
 * bij het aantal resultaten en de sorteerkeuze, want dat is waar je kijkt als je
 * de lijst wilt bijsturen.
 *
 * Winkelvoorraad hoort in dezelfde rij (Kevin, 13 aug: "zelfde als 'alleen mijn
 * maat', zo'n pil, en er ook naast"). Het stond nog als aanvinklijst in een
 * kadertje in de filterkolom, terwijl het exact dezelfde soort keuze is: een
 * persoonlijk filter met twee standen. Twee vormen voor één ding leest als twee
 * verschillende dingen — dus staan de winkels hier nu ook als pil, in dezelfde
 * volgorde als je ze koos, met de telling erbij zodat je ziet wat het oplevert.
 * De KIEZER ("Winkels wijzigen") staat als tekstknopje achter de pillen: dat is
 * een instelling, geen filter, en verdient dus geen pil.
 */
export function PlpActiveChips({
  selection,
  mySize,
  mySizeCount,
  storeOptions = [],
  myStoreTitles = [],
}: {
  selection: PlpSelection;
  mySize?: { row: string; raw: string; facet: string } | null;
  /** Aantal artikelen in die maat — null als de maat niet in deze lijst voorkomt. */
  mySizeCount?: number | null;
  storeOptions?: PlpStoreOption[];
  /** Winkelnamen van de klant — de kiezer werkt op naam. */
  myStoreTitles?: string[];
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function apply(next: Partial<PlpSelection>) {
    const qs = buildPlpQuery({ ...selection, ...next, page: 1 });
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  /* Alleen als de klant PRECIES z'n eigen maat filtert. Koos 'ie er zelf nog een
     maat bij, dan is het geen "mijn maat"-filter meer en hoort de gewone
     maatfilter in het paneel het verhaal te vertellen. */
  const maatAan = Boolean(mySize && selection.sizes.length === 1 && selection.sizes[0] === mySize.facet);
  const maatAanbod = Boolean(mySize && !maatAan && (mySizeCount ?? 0) > 0);
  /* Eén rij winkels in de volgorde waarin de klant ze koos, met de stand per
     winkel — niet eerst alle aanstaande en dan de rest. Anders springt een pil
     naar voren op het moment dat je 'm aanzet, precies waar je muis nog staat.
     Een winkel zonder voorraad in deze lijst bieden we niet aan (die pil levert
     altijd nul op); staat 'ie wél aan, dan blijft 'ie staan — dan heeft de klant
     'm zelf aangezet en hoort 'ie te zien waaróm de lijst leeg is. */
  const winkels = storeOptions
    .map((s) => ({ ...s, aan: selection.stores.includes(s.pageHandle) }))
    .filter((s) => s.aan || (s.count ?? 0) > 0);
  const erIsEenWinkelAan = winkels.some((s) => s.aan);

  if (!maatAan && !maatAanbod && !winkels.length) return null;

  return (
    /* flex-wrap, geen horizontale scroll: bij scrollen verdwijnt juist uit beeld
       wélke filters aanstaan, en dat is precies wat deze rij moet tonen. */
    <div className={`mb-4 flex flex-wrap items-center gap-2 ${pending ? "opacity-60 transition-opacity" : ""}`}>
      {maatAan && mySize ? (
        <Chip
          label={`${t("plp.filters.mySizePrefix")} ${mySize.raw}`}
          onRemove={() => {
            track("filter", { props: { facet: "mijnmaat", value: mySize.raw, on: false, bron: "chip" } });
            apply({ sizes: [] });
          }}
          removeLabel={t("plp.chips.remove")}
        />
      ) : null}

      {maatAanbod && mySize ? (
        <Chip
          variant="offer"
          label={t("plp.chips.mySizeOffer", { size: mySize.raw })}
          onAdd={() => {
            track("filter", { props: { facet: "mijnmaat", value: mySize.raw, on: true, bron: "chip" } });
            apply({ sizes: [mySize.facet] });
          }}
        />
      ) : null}

      {winkels.map((s) =>
        s.aan ? (
          <Chip
            key={s.pageHandle}
            label={t("plp.chips.inStore", { city: s.city })}
            onRemove={() => {
              track("filter", { props: { facet: "winkel", value: s.pageHandle, on: false, bron: "chip" } });
              apply({ stores: selection.stores.filter((h) => h !== s.pageHandle) });
            }}
            removeLabel={t("plp.chips.remove")}
          />
        ) : (
          <Chip
            key={s.pageHandle}
            variant="offer"
            label={t("plp.chips.inStoreOffer", { city: s.city, count: s.count ?? 0 })}
            onAdd={() => {
              track("filter", { props: { facet: "winkel", value: s.pageHandle, on: true, bron: "chip" } });
              apply({ stores: [...selection.stores, s.pageHandle] });
            }}
          />
        ),
      )}

      {/* Kiezen is geen filter: een tekstknopje, geen pil. Staat achteraan zodat
          de pillen (wat je nú ziet) vooraan blijven. */}
      {storeOptions.length ? <StoreChooser myStores={myStoreTitles} variant="link" bron="plp" /> : null}

      {/* Eerlijk over de bron zodra er op voorraad gefilterd wordt: de
          winkeltelling loopt achter op wat er nú in het rek hangt. `basis-full`
          zet 'm op een eigen regel onder de pillen, zonder tweede wikkel. */}
      {erIsEenWinkelAan ? (
        <p className="basis-full font-sans text-xs text-muted">{t("plp.filters.storeDisclaimer")}</p>
      ) : null}
    </div>
  );
}

function Chip({
  label,
  onRemove,
  onAdd,
  removeLabel,
  variant = "actief",
}: {
  label: string;
  onRemove?: () => void;
  onAdd?: () => void;
  removeLabel?: string;
  variant?: "actief" | "offer";
}) {
  if (variant === "offer") {
    return (
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 font-sans text-sm text-ink transition-colors hover:border-ink"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        {label}
      </button>
    );
  }
  /* Eén knop voor label + kruisje: het hele chipje is de wis-actie. Twee
     losse doelen naast elkaar is op een telefoon te fijn om te raken. */
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={removeLabel ? `${label} — ${removeLabel}` : label}
      className="inline-flex min-h-9 items-center gap-2 rounded-full bg-ink px-3 py-1.5 font-sans text-sm text-canvas transition-opacity hover:opacity-85"
    >
      {label}
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 opacity-80" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
