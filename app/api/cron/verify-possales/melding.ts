import { gestrandTeller, type PosSalesVerificatie } from "@/lib/verify-pos-sales";

/**
 * De mailtekst van de kassabon-bewaking (app/api/cron/verify-possales).
 * Compact en scanbaar: geld eerst, context onderaan.
 *
 * Apart van route.ts zodat de opmaak ook zonder afwijking te bekijken is. Deze
 * mails zijn per ontwerp zeldzaam — bij een schone stand gaat er niets uit —
 * dus anders zou deze tekst pas voor het eerst gelezen worden op de dag dat het
 * misgaat, en dan is een fout in de opmaak precies wat je niet wilt.
 */
export function meldingTekst(v: PosSalesVerificatie): string {
  const r: string[] = [];
  const gestrand = gestrandTeller(v);

  if (v.overRetour.length) {
    r.push(`[5] MEER GERETOURNEERD DAN VERKOCHT — ${v.overRetour.length} regel(s). Dit is geld: er is te veel terugbetaald.`);
    for (const o of v.overRetour.slice(0, 15)) {
      r.push(`      bon ${o.bon}  ${o.sleutel}  verkocht ${o.verkocht}, terug ${o.terug} (${o.retouren} retour(en))`);
    }
    if (v.overRetour.length > 15) r.push(`      … en nog ${v.overRetour.length - 15}`);
    r.push("");
  }

  if (v.ontbreekt.length) {
    r.push(`[1] In de blob maar NIET in Neon — ${v.ontbreekt.length} bon(nen). De dagstaat mist deze nu al.`);
    for (const s of v.ontbreekt.slice(0, 15)) {
      const eur = `EUR ${s.total.toFixed(2)}`;
      r.push(`      ${s.id}  ${s.store}  ${s.createdAt.slice(0, 16)}  ${eur}${s.cancelled ? "  [geannuleerd]" : ""}`);
    }
    if (v.ontbreekt.length > 15) r.push(`      … en nog ${v.ontbreekt.length - 15}`);
    r.push("");
  }

  if (gestrand.length) {
    r.push(
      v.gestrand.definitiefWeg
        ? `[2] Voorraad geboekt, geen bon in Neon én niet meer in de blob — ${gestrand.length} (definitief weg).`
        : `[2] Voorraad geboekt, geen bon in Neon — ${gestrand.length}. (Blob niet gelezen, dus niet te zien welke nog te redden zijn.)`,
    );
    for (const g of gestrand.slice(0, 15)) r.push(`      ${g.ref}  ${g.eerste.slice(0, 16)}  ${g.regels} regel(s)`);
    if (gestrand.length > 15) r.push(`      … en nog ${gestrand.length - 15}`);
    r.push("");
  }

  if (v.drift.length) {
    r.push(`[3] Status wijkt af tussen blob en Neon — ${v.drift.length}.`);
    for (const d of v.drift.slice(0, 10)) r.push(`      ${d.id}  ${d.store}  ${d.verschillen.join(" | ")}`);
    if (v.drift.length > 10) r.push(`      … en nog ${v.drift.length - 10}`);
    r.push("");
  }

  if (v.botsingen.length) {
    r.push(`[4] Zelfde client_ref, andere bon in Neon — ${v.botsingen.length}. Een retour kan hierdoor stil weggevallen zijn.`);
    for (const b of v.botsingen.slice(0, 10)) {
      r.push(`      ref ${b.ref}  blob=${b.blobId} (${b.blobKind})  neon=${b.neonId} (${b.neonKind})`);
    }
    if (v.botsingen.length > 10) r.push(`      … en nog ${v.botsingen.length - 10}`);
    r.push("");
  }

  if (v.dubbeleClientRefs) {
    r.push(`[gezondheid] ${v.dubbeleClientRefs} dubbele client_ref in Neon — de unieke index zou dit onmogelijk moeten maken.`);
    r.push("");
  }

  if (!v.blob.gelezen) {
    r.push(`LET OP: de storegents-blob was niet te lezen (${v.blob.reden}).`);
    r.push("Controles [1], [3] en [4] hebben dus NIET gedraaid. [2] en [5] wel — die zijn puur Neon.");
    r.push("");
  }

  r.push("— stand van zaken —");
  r.push(`Neon: ${v.neon.aantal} bonnen (${v.neon.oudste.slice(0, 10)} t/m ${v.neon.nieuwste.slice(0, 10)})`);
  if (v.blob.gelezen) r.push(`Blob: ${v.blob.aantal} bonnen (cap 5000)`);
  r.push(`Bonnen met meer dan één retour: ${v.bonnenMetMeerdereRetouren}.`);
  if (v.bonnenMetMeerdereRetouren > 0) {
    r.push("  Dit getal is de wekker: zolang het 0 was kón de over-retour-race niet afgaan, want");
    r.push("  daar zijn twee retouren op dezelfde bon voor nodig. Dat is nu niet meer zo, dus het");
    r.push("  is tijd om de guard alsnog race-vast te maken (teller + retourrij in één statement).");
  }
  r.push(`Bonnen jonger dan ${v.graceMinuten} minuten tellen niet mee — die kunnen legitiem nog onderweg zijn.`);
  r.push("");
  r.push("Zelf nakijken: npm run verify:possales");
  return r.join("\n");
}
