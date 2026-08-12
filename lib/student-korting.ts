/**
 * lib/student-korting.ts — de rekenkern van de verenigingskorting.
 *
 * Bewust een apart bestand zónder database-imports: dit is het stuk waar geld
 * doorheen loopt, en zo is het los te draaien en te testen (test/student-korting.test.ts).
 *
 * Vier soorten actie, allemaal per actie in te stellen:
 *   percent  X% over de deelnemende regels
 *   bedrag   een vast bedrag, één keer per bon, over de deelnemende regels
 *   nplusm   koop N, krijg M gratis (2+1) — het goedkoopste van de groep is gratis
 *   cadeau   koop N uit lijst A, krijg M artikelen uit lijst B (de cadeaulijst) gratis
 *
 * Twee regels die overal gelden:
 *  - "leeg = alles". Een lege productenlijst betekent ALLE artikelen; dat is wat
 *    Remy in de praktijk het vaakst wil en het scheelt hem 19 winkels aanvinken.
 *  - Gratis = het GOEDKOOPSTE artikel dat ervoor in aanmerking komt. Dat is de
 *    winkelstandaard bij 2+1, en het is de enige keuze die niet per bon anders
 *    uitpakt dan de kassier verwacht.
 */

export type KortingSoort = "percent" | "bedrag" | "nplusm" | "cadeau";

export const KORTING_SOORTEN: KortingSoort[] = ["percent", "bedrag", "nplusm", "cadeau"];

export function isKortingSoort(v: unknown): v is KortingSoort {
  return KORTING_SOORTEN.includes(String(v ?? "") as KortingSoort);
}

/** Het stukje actie waar de berekening iets aan heeft. */
export type ActieKorting = {
  kortingSoort: KortingSoort;
  kortingPct: number;
  kortingCent: number;
  koopAantal: number;
  gratisAantal: number;
  herhalen: boolean;
  producten: string[];
  cadeauProducten: string[];
};

export type KortingInvoerRegel = { sku?: string; barcode?: string; qty?: number; priceCent?: number };

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** Staat dit artikel in de lijst? Match op sku óf barcode. Lege lijst = alles. */
function staatInLijst(lijst: string[], sku: string, barcode: string, leegIsAlles: boolean): boolean {
  if (!lijst.length) return leegIsAlles;
  const s = lower(sku), b = lower(barcode);
  return lijst.some((p) => {
    const q = lower(p);
    return Boolean(q) && (q === s || (Boolean(b) && q === b));
  });
}

/** Doet dit artikel mee aan de actie? (lege productlijst = alles) */
export function doetMeeAanLijst(producten: string[], sku: string, barcode = ""): boolean {
  return staatInLijst(producten, sku, barcode, true);
}

/** Is dit een cadeau-artikel? (lege cadeaulijst = géén cadeaus — anders zou alles gratis zijn) */
export function isCadeauArtikel(cadeauProducten: string[], sku: string, barcode = ""): boolean {
  return staatInLijst(cadeauProducten, sku, barcode, false);
}

/** Eén verkocht exemplaar, met de regel waar het vandaan komt. */
type Stuk = { regel: number; priceCent: number };

function stukken(regels: KortingInvoerRegel[], hoort: (r: KortingInvoerRegel) => boolean): Stuk[] {
  const out: Stuk[] = [];
  regels.forEach((r, i) => {
    if (!hoort(r)) return;
    const qty = Math.max(1, Math.round(Number(r.qty) || 1));
    const priceCent = Math.max(0, Math.round(Number(r.priceCent) || 0));
    for (let n = 0; n < qty; n++) out.push({ regel: i, priceCent });
  });
  return out;
}

const heel = (v: unknown, min = 0) => Math.max(min, Math.round(Number(v) || 0));

/**
 * Korting per regel (in centen), in dezelfde volgorde als `regels`.
 * De som is nooit hoger dan wat de klant voor die regels betaalt.
 */
export function berekenKorting(actie: ActieKorting, regels: KortingInvoerRegel[]): number[] {
  const uit = regels.map(() => 0);
  if (!Array.isArray(regels) || !regels.length) return uit;

  const producten = Array.isArray(actie.producten) ? actie.producten : [];
  const cadeaus = Array.isArray(actie.cadeauProducten) ? actie.cadeauProducten : [];
  const meedoen = (r: KortingInvoerRegel) => doetMeeAanLijst(producten, String(r.sku ?? ""), String(r.barcode ?? ""));
  const isCadeau = (r: KortingInvoerRegel) => isCadeauArtikel(cadeaus, String(r.sku ?? ""), String(r.barcode ?? ""));
  const regelTotaal = (r: KortingInvoerRegel) => heel(r.priceCent) * Math.max(1, heel(r.qty, 1));

  switch (actie.kortingSoort) {
    case "percent": {
      const pct = Math.max(0, Math.min(100, heel(actie.kortingPct)));
      if (!pct) return uit;
      regels.forEach((r, i) => {
        if (meedoen(r)) uit[i] = Math.round((regelTotaal(r) * pct) / 100);
      });
      return uit;
    }

    case "bedrag": {
      /* Eén keer per bon, en nooit meer dan de klant voor de deelnemende regels
         betaalt — anders zou een bon van €15 met een €25-actie geld uitkeren. */
      const wens = heel(actie.kortingCent);
      if (!wens) return uit;
      const mee = regels.map((r, i) => ({ i, cent: meedoen(r) ? regelTotaal(r) : 0 }));
      const basis = mee.reduce((s, m) => s + m.cent, 0);
      if (!basis) return uit;
      const totaal = Math.min(wens, basis);
      /* Evenredig verdelen over de regels; de restcenten gaan naar de grootste
         resten, zodat de som exact klopt met wat er van de bon af gaat. */
      let verdeeld = 0;
      const resten: { i: number; rest: number }[] = [];
      for (const m of mee) {
        if (!m.cent) continue;
        const exact = (totaal * m.cent) / basis;
        const deel = Math.floor(exact);
        uit[m.i] = deel;
        verdeeld += deel;
        resten.push({ i: m.i, rest: exact - deel });
      }
      resten.sort((a, b) => b.rest - a.rest);
      for (let k = 0; verdeeld < totaal && k < resten.length; k++, verdeeld++) uit[resten[k].i] += 1;
      return uit;
    }

    case "nplusm": {
      const koop = heel(actie.koopAantal);
      const gratis = heel(actie.gratisAantal);
      if (koop < 1 || gratis < 1) return uit;
      const groep = koop + gratis;
      /* Duurste eerst: dan zijn de laatste M van elke groep vanzelf de goedkoopste. */
      const alle = stukken(regels, meedoen).sort((a, b) => b.priceCent - a.priceCent);
      const volle = Math.floor(alle.length / groep);
      const groepen = actie.herhalen ? volle : Math.min(1, volle);
      for (let g = 0; g < groepen; g++) {
        for (let k = koop; k < groep; k++) {
          const stuk = alle[g * groep + k];
          uit[stuk.regel] += stuk.priceCent;
        }
      }
      return uit;
    }

    case "cadeau": {
      const gratis = Math.max(1, heel(actie.gratisAantal));
      const drempel = Math.max(1, heel(actie.koopAantal));
      if (!cadeaus.length) return uit;
      /* Een artikel telt óf als aankoop óf als cadeau, nooit als allebei: anders
         betaalt de klant voor niets en krijgt hij hetzelfde stuk gratis terug. */
      const kwalificerend = stukken(regels, (r) => meedoen(r) && !isCadeau(r));
      if (kwalificerend.length < drempel) return uit;
      const keer = actie.herhalen ? Math.floor(kwalificerend.length / drempel) : 1;
      const teGeven = keer * gratis;
      /* Goedkoopste cadeaus eerst weggeven. */
      const cadeauStukken = stukken(regels, isCadeau).sort((a, b) => a.priceCent - b.priceCent);
      for (let k = 0; k < Math.min(teGeven, cadeauStukken.length); k++) {
        const stuk = cadeauStukken[k];
        uit[stuk.regel] += stuk.priceCent;
      }
      return uit;
    }

    default:
      return uit;
  }
}

/** Korte, leesbare samenvatting van de actie — voor kassa en beheerscherm. */
export function kortingOmschrijving(actie: ActieKorting): string {
  switch (actie.kortingSoort) {
    case "percent": return `${heel(actie.kortingPct)}% korting`;
    case "bedrag": return `€ ${(heel(actie.kortingCent) / 100).toFixed(2).replace(".", ",")} korting`;
    case "nplusm": return `${heel(actie.koopAantal)}+${heel(actie.gratisAantal)} gratis`;
    case "cadeau": return `${heel(actie.gratisAantal) || 1}× gratis bij ${Math.max(1, heel(actie.koopAantal))} artikel(en)`;
    default: return "";
  }
}
