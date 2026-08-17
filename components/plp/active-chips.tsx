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
 * Winkelvoorraad staat in dezelfde rij (Kevin, 13 aug), maar als ÉÉN keuzelijst
 * en niet als pil per winkel: "moet een dropdown zijn dat je winkel kan kiezen,
 * niet elke winkel een aparte pill". Met vier winkels waren het vier pillen over
 * twee regels, en die duwden de eerste producten van het scherm — terwijl het om
 * één vraag gaat ("in welke winkel?") met één antwoord. Een keuzelijst zegt dat
 * ook: één regel, de gekozen winkel staat er als waarde in, en de tellingen
 * staan bij de opties zodat je ziet wat elke winkel oplevert. Zelfde patroon als
 * "Sorteer" rechts van deze rij.
 * De KIEZER staat erachter: als tekstknopje ("Winkels wijzigen") zodra er
 * winkels zijn, en als pil ("Kies je winkel(s)") zolang die er niet zijn — die
 * uitnodiging stond eerst als kadertje in de filterkolom, en daarmee stond
 * winkelvoorraad er voor een nieuwe bezoeker nog steeds links (Kevin, 13 aug).
 * Alles wat met winkels te maken heeft hoort in deze rij; de filterkolom is voor
 * de gewone facetten.
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
  /* De winkels in de volgorde waarin de klant ze koos. Een winkel zonder
     voorraad in deze lijst laten we staan mét zijn nul: in een keuzelijst is dat
     één regel die iets vertelt ("hier ligt niets"), geen pil die ruimte kost. */
  const winkels = storeOptions.map((s) => ({ ...s, aan: selection.stores.includes(s.pageHandle) }));
  const gekozen = winkels.filter((s) => s.aan);
  /* Zonder gekozen winkel valt er niets te kiezen — dan is de kiezer zélf de
     pil, want anders verdwijnt "kijk of het in je winkel ligt" van de lijst. */
  const kiezerAlsPil = storeOptions.length === 0;

  if (!maatAan && !maatAanbod && !winkels.length && !kiezerAlsPil) return null;

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

      {winkels.length ? (
        <label className="inline-flex min-h-9 items-center gap-2 font-sans text-sm">
          <span className="text-muted">{t("plp.filters.storeStock")}</span>
          <select
            /* Meer dan één winkel in de URL kan alleen via een gedeelde link; dan
               staat er een eigen (uitgezette) regel bovenin, zodat de lijst niet
               liegt over wat er gefilterd wordt. Kiezen vervángt de selectie. */
            value={gekozen.length > 1 ? "meerdere" : (gekozen[0]?.pageHandle ?? "")}
            onChange={(e) => {
              const handle = e.target.value;
              track("filter", { props: { facet: "winkel", value: handle || "alle", on: Boolean(handle), bron: "keuzelijst" } });
              apply({ stores: handle ? [handle] : [] });
            }}
            aria-label={t("plp.filters.storeStock")}
            className="max-w-[13rem] rounded-full border border-line bg-canvas px-3 py-1.5 font-sans text-sm focus:border-ink focus:outline-none"
          >
            <option value="">{t("plp.filters.storeAll")}</option>
            {gekozen.length > 1 ? (
              <option value="meerdere" disabled>
                {t("plp.filters.storeMultiple", { count: gekozen.length })}
              </option>
            ) : null}
            {winkels.map((s) => (
              <option key={s.pageHandle} value={s.pageHandle}>
                {typeof s.count === "number" ? `${s.city} (${s.count})` : s.city}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {/* Achteraan, zodat wat je nú ziet vooraan blijft. Heb je al winkels, dan
          is wijzigen een instelling → tekstknopje. Heb je er nog geen, dan is dit
          het enige winkel-aanbod op de pagina → pil. */}
      <StoreChooser myStores={myStoreTitles} variant={kiezerAlsPil ? "pill" : "link"} bron="plp" />

      {/* Eerlijk over de bron zodra er op voorraad gefilterd wordt: de
          winkeltelling loopt achter op wat er nú in het rek hangt. `basis-full`
          zet 'm op een eigen regel eronder, zonder tweede wikkel. */}
      {gekozen.length ? (
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
