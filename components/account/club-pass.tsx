"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { CLUB_LOGO_LIGHT, CLUB_LOGO_SIZE, CLUB_NAME } from "@/lib/club";
import type { ClubPassData, ClubPassQr } from "@/lib/club-pass";
import { qrPad } from "@/lib/club-pas-regels";
import { useT } from "@/components/i18n/locale-provider";

/**
 * De clubpas in het account — dezelfde pas als in Apple/Google Wallet, maar dan
 * op het scherm, zodat een klant zonder wallet 'm gewoon kan laten scannen.
 *
 * Twee dingen sturen het ontwerp, allebei omdat dit ding aan een kassa gebruikt
 * wordt en niet op de bank:
 *
 *  1. De QR staat ZWART OP WIT, ook al is de pas zelf zwart. Een omgekeerde code
 *     lezen is optioneel gedrag in de norm; sommige handscanners doen het, de
 *     onze niet gegarandeerd. Het witte vlak is dus geen stijlkeuze.
 *  2. "Groter tonen" zet 'm schermvullend op wit. Dat is wat je aan de kassa
 *     nodig hebt: een groot, licht vlak dat een scanner in één keer pakt, zonder
 *     dat de klant staat te knijpen om in te zoomen.
 *
 * De matrix komt kant-en-klaar van de server (lib/club-pass); hier zit geen
 * QR-berekening, zodat de code er al staat bij de eerste render.
 */

/** Verplichte stille rand rondom de code, in modules. Minder = scanners haken af. */
const QUIET_ZONE = 4;

/**
 * De maat staat als ATTRIBUUT op de svg, niet in een utility-klasse. Dit is het
 * enige element op de pagina waarvan de afmeting functioneel is: te klein en de
 * kassascanner scheidt de modules niet meer. Een CSS-klasse die om welke reden
 * dan ook niet meekomt in de build levert dan een code van nul bij nul op — en
 * dat merk je pas als er iemand aan de kassa staat.
 */
function QrSvg({ qr, px, meegroeien = false }: { qr: ClubPassQr; px: number; meegroeien?: boolean }) {
  const totaal = qr.size + QUIET_ZONE * 2;
  // Eén path i.p.v. honderden <rect>-elementen; crispEdges houdt de modules
  // scherp gescheiden — antialiasing tussen twee modules is precies wat een
  // scanner op een klein scherm de das omdoet. De padberekening zelf staat in
  // lib/club-pas-regels, met tests erop (rij/kolom-omkering is onzichtbaar).
  const d = qrPad(qr.rows, QUIET_ZONE);
  return (
    <svg
      viewBox={`0 0 ${totaal} ${totaal}`}
      width={px}
      height={px}
      shapeRendering="crispEdges"
      /* height:auto is niet optioneel: zodra de breedte krimpt of groeit moet de
         hoogte mee, anders staat er een uitgerekte QR — en dat is geen QR meer.
         `meegroeien` vult de beschikbare breedte tot aan px (schermvullende
         stand); zonder groeit hij niet en is px de vaste maat (op de kaart). */
      style={
        meegroeien
          ? { display: "block", width: "100%", maxWidth: px, height: "auto" }
          : { display: "block", width: px, maxWidth: "100%", height: "auto" }
      }
      /* Voor een schermlezer is een blokjespatroon niets waard; de lidcode staat
         er als tekst naast en dát is de bruikbare variant. */
      aria-hidden
    >
      <rect width={totaal} height={totaal} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}

/** Schermvullend, wit, code zo groot mogelijk — de stand voor aan de kassa. */
function GrootScherm({ pass, onClose }: { pass: ClubPassData; onClose: () => void }) {
  const t = useT();
  const sluitRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    sluitRef.current?.focus();
    const opToets = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", opToets);
    // Achtergrond niet mee laten scrollen terwijl de pas openstaat.
    const vorige = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", opToets);
      document.body.style.overflow = vorige;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={CLUB_NAME}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-white p-6"
    >
      {/* Zo groot als het scherm toelaat, met een bovengrens zodat hij op een
          desktop niet belachelijk wordt. 320 px = ruim 8 px per module: dat
          leest elke scanner, ook schuin en met wat reflectie. */}
      <QrSvg qr={pass.qr} px={320} meegroeien />
      <p className="font-sans text-base tracking-widest text-black">{pass.memberCode}</p>
      <p className="max-w-xs text-center font-sans text-sm text-black/60">{t("account.pass.brightness")}</p>
      <button
        ref={sluitRef}
        type="button"
        onClick={onClose}
        className="border border-black/20 px-6 py-2.5 font-sans text-sm text-black"
      >
        {t("account.pass.close")}
      </button>
    </div>
  );
}

/**
 * De pas als kaart: code links, gegevens rechts — de vorm van een pasje, niet
 * van een banner. Vandaar ook de breedtelimiet: over de volle kolom uitgerekt
 * bleef er rechts een half scherm zwart over.
 *
 * Het saldo staat hier op de pas, waar een klant het verwacht. Het getal dat
 * hier staat is het BESTEEDBARE saldo — hetzelfde getal dat de kassier ziet.
 * Punten in behandeling staan er als aparte regel onder en nooit opgeteld: dat
 * verschil is precies waar anders ruzie over ontstaat aan de kassa.
 */
export function ClubPassCard({
  pass,
  available,
  pending = 0,
}: {
  pass: ClubPassData;
  available: number;
  pending?: number;
}) {
  const t = useT();
  const [groot, setGroot] = useState(false);
  return (
    <div className="max-w-2xl bg-ink p-5 text-canvas sm:p-6">
      <Image
        src={CLUB_LOGO_LIGHT}
        alt={CLUB_NAME}
        width={CLUB_LOGO_SIZE.width}
        height={CLUB_LOGO_SIZE.height}
        style={{ height: "auto", width: "10rem", maxWidth: "100%" }}
      />
      {/* Twee kolommen, ook op een telefoon — gestapeld wordt dit een lap en
          geen pasje. Op klein scherm een krappere tussenruimte, anders houdt de
          rechterkolom te weinig over en breekt het lidnummer over twee regels. */}
      <div className="mt-6 flex items-start gap-4 sm:gap-6">
        {/* De code is de knop: aan de kassa tik je op wat je wilt laten zien. */}
        <button
          type="button"
          onClick={() => setGroot(true)}
          aria-label={t("account.pass.showBig")}
          className="shrink-0 bg-white p-2.5"
        >
          {/* Eén vaste maat, geen responsieve breedteklasse. Groter dan dit en
              de rechterkolom wordt op een telefoon zo smal dat het lidnummer
              over twee regels breekt. Dit is de tikdoel-variant; scannen doe je
              met "Groter tonen", en dát is de maat die een scanner moet halen. */}
          <QrSvg qr={pass.qr} px={104} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="label-brand !text-canvas/55">{t("account.pass.member")}</p>
          <p className="mt-1 font-sans text-sm tracking-widest text-canvas">{pass.memberCode}</p>
          <p className="label-brand mt-5 !text-canvas/55">{t("account.points.balanceTitle")}</p>
          <p className="mt-1 font-display text-3xl font-light leading-none text-canvas">
            {available} <span className="text-base text-canvas/60">{t("account.points.available")}</span>
          </p>
          {/* De KORTE variant van "in behandeling": op een pasje past geen hele
              zin. De uitleg erbij ("beschikbaar na de retourperiode") staat in
              de kaart eronder, waar wel ruimte is. */}
          {pending > 0 && (
            <p className="mt-1.5 font-sans text-xs text-canvas/60">{t("account.overview.pointsPending", { n: pending })}</p>
          )}
        </div>
      </div>
      <p className="mt-5 font-sans text-sm leading-relaxed text-canvas/70">{t("account.pass.scanHint")}</p>
      <button
        type="button"
        onClick={() => setGroot(true)}
        className="mt-4 border border-canvas/30 px-5 py-2.5 font-sans text-sm text-canvas transition-colors hover:bg-canvas hover:text-ink"
      >
        {t("account.pass.showBig")}
      </button>
      {groot && <GrootScherm pass={pass} onClose={() => setGroot(false)} />}
    </div>
  );
}

/** Losse knop (overzichtstab): één tik van binnenkomen naar een scanbare code. */
export function ClubPassButton({ pass }: { pass: ClubPassData }) {
  const t = useT();
  const [groot, setGroot] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setGroot(true)}
        className="border border-line px-5 py-2.5 font-sans text-sm text-ink transition-colors hover:bg-ink hover:text-canvas"
      >
        {t("account.pass.open")}
      </button>
      {groot && <GrootScherm pass={pass} onClose={() => setGroot(false)} />}
    </>
  );
}
