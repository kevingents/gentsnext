/**
 * Pure verdeling van de veiligheidsvoorraad. Bewust een los JS-bestand zonder
 * Next-imports zodat `node --test` erbij kan (zelfde patroon als
 * lib/ab-regels.js) — dit is de rekenkern die bepaalt welke stuks NIET online
 * verkocht mogen worden, en die hoort onder test te staan.
 * lib/safety-stock.ts levert de types en de kant met DB/settings.
 */

/** Sleutel in de allocatie-map: filiaal + artikelsleutel (hoofdletterongevoelig). */
export function safetyKey(branchId, key) {
  return `${String(branchId)}|${String(key || "").toLowerCase()}`;
}

/** Sorteer-helper: numeriek als beide getallen zijn, anders alfabetisch. */
function cmp(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Verdeel één budget (stuks per artikel) over voorraadregels — dunste regel
 * eerst. Daar zit het risico dat de marge afdekt: één stuk aan het rek kan een
 * displaystuk of een mistelling zijn. De diepte blijft zo online verkoopbaar.
 *
 * Bij gelijke stand: laagste filiaalnummer, dan sku. Die tie-break is geen
 * detail maar de kern — de PDP, de allocatie en de kassa-lezing rekenen los van
 * elkaar en moeten exact dezelfde stuks vasthouden, anders belooft de site
 * voorraad die de allocatie niet mag pakken.
 *
 * Ronde voor ronde één stuk per regel: bij budget 2 raken we twee dunne regels
 * in plaats van één regel twee keer — dat neemt de twee wankelste stuks uit de
 * verkoop in plaats van één winkel z'n hele maat af te pakken.
 *
 * @param {{branchId: string, sku: string, qty: number}[]} rows
 * @param {number} budget
 * @param {Map<string, number>} into  wordt aangevuld (branch|sku → stuks)
 */
export function verdeelBudget(rows, budget, into) {
  let rest = Math.max(0, Math.floor(Number(budget) || 0));
  if (!rest) return into;
  const werk = rows
    .filter((r) => r && Number(r.qty) > 0)
    .map((r) => ({ branchId: String(r.branchId), sku: String(r.sku), qty: Number(r.qty), over: Number(r.qty) }))
    .sort((a, b) => a.qty - b.qty || cmp(a.branchId, b.branchId) || cmp(a.sku, b.sku));
  let geraakt = true;
  while (rest > 0 && geraakt) {
    geraakt = false;
    for (const r of werk) {
      if (rest <= 0) break;
      if (r.over <= 0) continue;
      r.over -= 1;
      rest -= 1;
      geraakt = true;
      const k = safetyKey(r.branchId, r.sku);
      into.set(k, (into.get(k) || 0) + 1);
    }
  }
  return into;
}
