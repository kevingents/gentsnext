import "@/lib/load-env";
import { gestrandTeller, totaalAfwijkingen, verifyPosSales } from "@/lib/verify-pos-sales";

/**
 * Print het verschil tussen de storegents-blob admin/pos-sales.json en de
 * Neon-tabel pos_sales, plus de over-retour-detector. UITSLUITEND LEZEN.
 *   npm run verify:possales
 *
 * De controles zelf staan in lib/verify-pos-sales (daar staat ook waaróm elke
 * controle er is); dit bestand is alleen de opmaak. Dezelfde lib draait
 * dagelijks als cron (app/api/cron/verify-possales) en mailt als er iets is —
 * zo kunnen de handmatige run en de bewaking niet uit elkaar lopen.
 *
 * Vijf getallen. Alle vijf horen 0 te zijn.
 */
function euro(n: unknown): string {
  return `EUR ${(Number(n) || 0).toFixed(2)}`;
}

async function main() {
  const v = await verifyPosSales();

  console.log("=".repeat(78));
  if (v.blob.gelezen) {
    console.log(`blob : ${v.blob.aantal} bonnen (cap 5000)`);
  } else {
    console.log(`blob : NIET GELEZEN — ${v.blob.reden}`);
    console.log("       [1], [3] en [4] konden niet draaien; [2] en [5] wel (die zijn puur Neon).");
  }
  console.log(`neon : ${v.neon.aantal} bonnen   ${v.neon.oudste.slice(0, 10)} t/m ${v.neon.nieuwste.slice(0, 10)}`);
  console.log(`grace: bonnen jonger dan ${v.graceMinuten} min tellen niet mee (blob- en core-schrijf lopen niet gelijk op)`);
  console.log("=".repeat(78));

  console.log(`\n[1] In de blob maar NIET in Neon: ${v.ontbreekt.length}`);
  for (const s of v.ontbreekt.slice(0, 15)) {
    console.log(
      `      ${s.id.padEnd(28)} ${s.store.padEnd(22)} ${s.createdAt.slice(0, 16).padEnd(17)} ${euro(s.total)}${s.cancelled ? "  [geannuleerd]" : ""}`,
    );
  }
  if (v.ontbreekt.length > 15) console.log(`      … en nog ${v.ontbreekt.length - 15}`);

  const gestrand = gestrandTeller(v);
  console.log(`\n[2] Voorraad geboekt maar GEEN bon in Neon: ${v.gestrand.alle.length}`);
  if (v.gestrand.definitiefWeg) {
    console.log(`      waarvan ook niet meer in de blob (definitief weg): ${v.gestrand.definitiefWeg.length}`);
  } else {
    console.log("      (blob niet gelezen — niet vast te stellen welke hiervan nog te redden zijn)");
  }
  for (const g of gestrand.slice(0, 15)) {
    console.log(`      ${g.ref.padEnd(28)} ${g.eerste.slice(0, 16)}   ${g.regels} regel(s)`);
  }
  if (gestrand.length > 15) console.log(`      … en nog ${gestrand.length - 15}`);

  console.log(`\n[3] Status wijkt af tussen blob en Neon: ${v.drift.length}`);
  for (const d of v.drift.slice(0, 15)) {
    console.log(`      ${d.id.padEnd(28)} ${d.store.padEnd(22)} ${d.verschillen.join(" | ")}`);
  }
  if (v.drift.length > 15) console.log(`      … en nog ${v.drift.length - 15}`);

  console.log(`\n[4] Zelfde client_ref, ANDERE bon in Neon (soort-botsing): ${v.botsingen.length}`);
  for (const b of v.botsingen.slice(0, 15)) {
    console.log(`      ref ${b.ref.padEnd(24)} blob=${b.blobId} (${b.blobKind})  neon=${b.neonId} (${b.neonKind})`);
  }

  console.log(`\n[5] Meer geretourneerd dan verkocht: ${v.overRetour.length}`);
  for (const r of v.overRetour.slice(0, 15)) {
    console.log(`      bon ${r.bon.padEnd(26)} ${r.sleutel.padEnd(16)} verkocht ${r.verkocht}  terug ${r.terug}  (${r.retouren} retour(en))`);
  }
  console.log(`      bonnen met meer dan één retour: ${v.bonnenMetMeerdereRetouren} (context — niet fout)`);

  console.log(`\n[gezondheid] Dubbele client_ref in Neon: ${v.dubbeleClientRefs} (hoort 0 te zijn)`);

  const totaal = totaalAfwijkingen(v);
  console.log("\n" + "=".repeat(78));
  if (totaal === 0) {
    console.log("SCHOON — blob en Neon lopen gelijk, en er is nergens te veel geretourneerd.");
  } else {
    console.log(`${totaal} afwijking(en) gevonden.`);
    if (v.ontbreekt.length || gestrand.length) {
      console.log("Let op: [1] en [2] zijn bonnen die de DAGSTAAT nu al mist (die leest Neon-first).");
    }
    if (v.overRetour.length) {
      console.log("Let op: [5] is GELD — er is meer terugbetaald dan er verkocht is. Direct uitzoeken.");
    }
  }
  console.log("=".repeat(78));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL:", e);
    process.exit(1);
  });
