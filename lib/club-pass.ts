import qr from "qrcode-generator";
import { clubMemberCode } from "@/lib/club";

/**
 * lib/club-pass.ts
 *
 * De memberspas op het SCHERM — dezelfde pas als in Apple/Google Wallet, maar dan
 * in het account, zodat een klant die geen wallet gebruikt 'm alsnog kan laten
 * scannen aan de kassa.
 *
 * Waarom de QR hier op de server gebouwd wordt en niet in de browser:
 * de kassa moet 'm kunnen scannen op het moment dat de klant z'n telefoon
 * omhoog houdt. Een QR die pas verschijnt als er nog JavaScript geladen moet
 * worden is precies dan te laat. Dit levert een matrix op die de pagina als
 * platte SVG rendert — geen client-bundel, geen netwerkverzoek, staat er in de
 * eerste render.
 *
 * WAT ER IN DE QR STAAT IS EEN AFSPRAAK MET DE KASSA: het kale klant-id, exact
 * zoals op de Apple- en Google-pas. /api/core/customer-search herkent dat als
 * UUID en zoekt er hard op. Zet hier dus nooit een URL of een prefix omheen —
 * dan valt de scan terug op de ILIKE-zoek over e-mail/naam en geeft "geen
 * klant" terwijl de klant voor je staat.
 */

export type ClubPassQr = {
  /** Aantal modules per zijde (inclusief de verplichte rand? nee — zonder). */
  size: number;
  /** Eén string per rij, "1" = donkere module. Compact genoeg om als prop mee te geven. */
  rows: string[];
};

export type ClubPassData = {
  qr: ClubPassQr;
  /** "GENTS 1A2B3C4D" — voor een kassa met alleen een invoerveld. */
  memberCode: string;
};

/**
 * Bouwt de QR voor één klant.
 *
 * Foutcorrectie M: de pas wordt van een telefoonscherm gescand, vaak met vingers
 * half over het glas en met reflectie van de winkelverlichting. L is krapper dan
 * dat aankan; H maakt de matrix zo dicht dat een klein scherm de modules niet
 * meer scheidt. M is wat de Apple-pas óók gebruikt.
 *
 * Typenummer 0 = laat de bibliotheek de kleinste versie kiezen die past. Een
 * UUID van 36 tekens past ruim binnen versie 3.
 */
export function clubPassQr(customerId: string): ClubPassQr {
  const code = qr(0, "M");
  code.addData(String(customerId));
  code.make();
  const size = code.getModuleCount();
  const rows: string[] = [];
  for (let r = 0; r < size; r++) {
    let rij = "";
    for (let c = 0; c < size; c++) rij += code.isDark(r, c) ? "1" : "0";
    rows.push(rij);
  }
  return { size, rows };
}

/** Alles wat de pas-in-het-account nodig heeft, in één plain-JSON object. */
export function clubPassData(customerId: string): ClubPassData {
  return { qr: clubPassQr(customerId), memberCode: clubMemberCode(customerId) };
}
