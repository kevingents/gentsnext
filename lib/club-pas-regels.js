/**
 * lib/club-pas-regels.js
 *
 * De twee dingen aan de memberspas die een AFSPRAAK MET DE KASSA zijn, los van
 * React en los van de QR-bibliotheek zodat `node --test` ze kan vastleggen:
 *
 *   lidcode()  — wat er onder de code staat, en waar de kassa op mag zoeken
 *   qrPad()    — hoe de matrix een tekening wordt
 *
 * Waarom dit een eigen bestand is: allebei kunnen ze stilletjes verkeerd gaan.
 * Een lidcode van 7 tekens matcht opeens tien klanten; een pad dat rij en kolom
 * verwisselt levert een gespiegelde code die er precies zo uitziet als een
 * goede. Je merkt het pas als er iemand aan de kassa staat.
 */

/**
 * "GENTS 1A2B3C4D" — de eerste 8 tekens van het klant-id zonder streepjes.
 *
 * ACHT is geen smaakkwestie: /api/core/customer-search snijdt er aan de andere
 * kant precies evenveel af en weigert een code die op twee klanten matcht.
 * Verander je dit getal, dan moet die kant mee.
 */
export function lidcode(customerId) {
  return "GENTS " + String(customerId || "").replace(/-/g, "").slice(0, 8).toUpperCase();
}

/**
 * Bouwt het SVG-pad uit de modulematrix: één vierkantje per donkere module,
 * verschoven met de stille rand.
 *
 * `rows[r][c]` is rij r, kolom c — in SVG is dat x = c, y = r. Die omkering is
 * de klassieke fout, en een gespiegelde QR ziet er voor een mens identiek uit.
 */
export function qrPad(rows, quietZone) {
  const q = Number(quietZone) || 0;
  const delen = [];
  rows.forEach((rij, r) => {
    for (let c = 0; c < rij.length; c++) {
      if (rij[c] === "1") delen.push(`M${c + q} ${r + q}h1v1h-1z`);
    }
  });
  return delen.join("");
}
