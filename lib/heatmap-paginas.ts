import { isLocale } from "@/lib/i18n";
import {
  APPARATEN as APPARATEN_JS,
  CEL_KOLOMMEN as CEL_KOLOMMEN_JS,
  CEL_RIJ_PX as CEL_RIJ_PX_JS,
  GEMETEN_PAGINAS as GEMETEN_PAGINAS_JS,
  REFERENTIE_BREEDTE as REFERENTIE_BREEDTE_JS,
  apparaatVoorBreedte as apparaatVoorBreedteJs,
  magLabelVastleggen as magLabelVastleggenJs,
  medianeUitBuckets as medianeUitBucketsJs,
  schoonLabel as schoonLabelJs,
  selectorNaarCss as selectorNaarCssJs,
  sjabloonVoorKaalPad,
  titelVoorPagina as titelVoorPaginaJs,
} from "@/lib/heatmap-regels";

/**
 * Getypte schil om lib/heatmap-regels.js — daar staan de regels zelf, hier de
 * types en het enige stuk dat Next-kennis nodig heeft: het locale-prefix.
 *
 * Waarom die splitsing: de regels (welke pagina's gemeten worden, wat er uit een
 * label gefilterd wordt) zijn precies het deel waar een stille fout het duurst
 * is, en `node --test` kan geen TypeScript importeren. Zelfde opzet als
 * lib/ab-regels.js ↔ lib/experiments.ts.
 *
 * Zowel de browser als de server gebruikt dit. De browser om te bepalen óf hij
 * meet, de server om te bepalen of hij het mág opslaan — die tweede vertrouwt
 * de eerste bewust niet en rekent alles opnieuw uit.
 */

export type Apparaat = "mobiel" | "tablet" | "desktop";

export const APPARATEN = APPARATEN_JS as Apparaat[];
export const REFERENTIE_BREEDTE = REFERENTIE_BREEDTE_JS as Record<Apparaat, number>;
export const GEMETEN_PAGINAS = GEMETEN_PAGINAS_JS as { key: string; titel: string }[];
export const CEL_KOLOMMEN: number = CEL_KOLOMMEN_JS;
export const CEL_RIJ_PX: number = CEL_RIJ_PX_JS;

export const apparaatVoorBreedte = apparaatVoorBreedteJs as (breedte: number) => Apparaat;
export const magLabelVastleggen = magLabelVastleggenJs as (paginaKey: string) => boolean;
export const schoonLabel = schoonLabelJs as (ruw: string) => string;
export const selectorNaarCss = selectorNaarCssJs as (selector: string) => string;
export const titelVoorPagina = titelVoorPaginaJs as (key: string) => string;
export const medianeUitBuckets = medianeUitBucketsJs as (buckets: Map<number, number>) => number;

export function isApparaat(v: unknown): v is Apparaat {
  return typeof v === "string" && (APPARATEN as string[]).includes(v);
}

/**
 * URL → paginasjabloon. Lege string betekent: deze pagina meten we niet.
 *
 * Het locale-prefix gaat eraf (/en/products/x → /products/x): de heatmap van
 * een pagina hoort niet per taal uiteen te vallen, het zijn dezelfde knoppen.
 */
export function paginaSjabloon(pad: string): string {
  if (!pad) return "";
  let p = String(pad).split("?")[0].split("#")[0];
  if (!p.startsWith("/")) p = `/${p}`;
  const eerste = p.split("/")[1] || "";
  if (isLocale(eerste)) p = p.slice(eerste.length + 1) || "/";
  return sjabloonVoorKaalPad(p);
}

/** Wordt deze pagina gemeten? */
export function wordtGemeten(pad: string): boolean {
  return paginaSjabloon(pad) !== "";
}

/** Klik-soorten. `dood` = niets klikbaars geraakt, `woede` = herhaald rammen. */
export type KlikSoort = "klik" | "dood" | "woede";

export function isKlikSoort(v: unknown): v is KlikSoort {
  return v === "klik" || v === "dood" || v === "woede";
}
