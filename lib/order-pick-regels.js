/**
 * lib/order-pick-regels.js — pure beslislogica voor de voorraad-afboeking van een
 * WINKELDEEL van een (split-)bezorgweborder bij het gereedmelden (/api/core/order-pick).
 *
 * WAAROM DIT BESTAAT: het winkeldeel van een bezorgweborder boekte nergens voorraad
 * uit. De web-reservering (webReservedAllLocations) hield het stuk vast tot 'shipped',
 * maar daarna viel de reservering vrij en telde het stuk in Neon én SRS weer als
 * beschikbaar — terwijl het de deur uit was. De fix: bij het gereedmelden een échte
 * −1-movement (channel 'transfer'), gespiegeld naar SRS als transferbon 'naar' het
 * webshop-filiaal. Deze module bepaalt WELKE ref er geboekt moet worden; het echte
 * schrijven zit in lib/store-core.ts (recordOrderPickMovement).
 *
 * Het ref-schema is een tellertje binnen één "familie" per (order, winkeldeel):
 *   pick 1:      ORDERPICK-<order>-<winkel>
 *   undo 1:      ORDERPICK-<order>-<winkel>-UNDO-1
 *   pick 2:      ORDERPICK-<order>-<winkel>-2
 *   undo 2:      ORDERPICK-<order>-<winkel>-UNDO-2  …enz.
 * Eén vaste ref (met onConflictDoNothing) was niet genoeg: na een undo (+1) zou een
 * her-pick op de oorspronkelijke ref stil conflicteren en per saldo 0 boeken — een
 * verkocht stuk dat eeuwig als beschikbaar telt. Het tellertje maakt élke overgang
 * boekbaar én houdt dubbelkliks/retries idempotent (zelfde stand → zelfde ref →
 * unieke-index vangt 'm af, of we boeken helemaal niet).
 */

const norm = (v) => String(v == null ? "" : v).trim();

/** Basis-ref van de pick-familie: ORDERPICK-<ordernummer>-<winkelsleutel>.
 *  De winkelsleutel wordt plat geslagen naar [a-z0-9-] zodat de ref geen spaties
 *  draagt en LIKE-zoeken op het voorvoegsel betrouwbaar is. '' = niet boekbaar. */
export function orderPickRefBase(orderNumber, storeKey) {
  const nr = norm(orderNumber);
  const key = norm(storeKey)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!nr || !key) return "";
  return `ORDERPICK-${nr}-${key}`;
}

const isUndoRef = (ref) => /-UNDO-\d+$/.test(String(ref || ""));

/** Stand van een familie op basis van de al-geboekte refs: hoeveel picks en undo's,
 *  en (als er netto een pick staat) wat de staande pick-ref is. */
export function orderPickStand(refs, base) {
  const uniq = [...new Set((Array.isArray(refs) ? refs : []).map(norm).filter(Boolean))];
  const undos = uniq.filter(isUndoRef).length;
  const picks = uniq.length - undos;
  const openstaand = picks > undos;
  // De ref van de laatste pick is afleidbaar uit de tellerstand (pick n heeft
  // suffix -n, behalve n=1) — niet uit lexicografisch sorteren (base-10 < base-2).
  const staandeRef = openstaand ? (picks === 1 ? base : `${base}-${picks}`) : null;
  return { picks, undos, openstaand, staandeRef };
}

/**
 * Beslis wat er geboekt moet worden bij een gereedmelding (done=true) of het
 * ongedaan maken daarvan (done=false), gegeven de al-geboekte refs van de familie.
 *
 *   → { boek: true,  ref, sign }   er moet een movement geboekt worden
 *   → { boek: false, ref }         niets te boeken (idempotente herhaling);
 *                                  ref = de staande pick-ref (voor de SRS-spiegel)
 *                                  of null als er niets staat
 */
export function orderPickBeslissing(refs, base, done) {
  if (!base) return { boek: false, ref: null };
  const stand = orderPickStand(refs, base);
  if (done) {
    // Al netto gepickt → niets boeken, maar wél de staande ref teruggeven zodat de
    // aanroeper (storegents) een eerder mislukte SRS-sync-markering kan herkansen.
    if (stand.openstaand) return { boek: false, ref: stand.staandeRef };
    const n = stand.picks + 1;
    return { boek: true, ref: n === 1 ? base : `${base}-${n}`, sign: -1 };
  }
  // Undo: alleen compenseren als er netto een pick staat — anders is er niets
  // om terug te draaien (dubbele undo-klik, of nooit gepickt).
  if (!stand.openstaand) return { boek: false, ref: null };
  return { boek: true, ref: `${base}-UNDO-${stand.undos + 1}`, sign: 1 };
}
