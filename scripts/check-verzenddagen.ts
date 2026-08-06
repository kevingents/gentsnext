/**
 * Controle op de verzendkalender: feestdagen, openingstijden en sluitingsuren.
 *
 * Deze logica bepaalt wat we de klant beloven ("morgen in huis") en welke winkel
 * een order krijgt. Hij faalt stil — een verkeerde feestdag of een dag die als
 * open wordt gelezen levert geen foutmelding op, alleen een order bij een dichte
 * deur. Vandaar deze zelftest zonder database.
 *
 *   npm run check:verzenddagen
 */
import { holidaysForYear, isHoliday } from "@/lib/fulfillment-config";
import { getStores, isOpenOnDay, closingHourOnDay, DAYS } from "@/lib/stores";

let fouten = 0;
function check(naam: string, ok: boolean, extra = "") {
  if (ok) {
    console.log(`  ok   ${naam}`);
  } else {
    fouten += 1;
    console.log(`  FOUT ${naam}${extra ? ` — ${extra}` : ""}`);
  }
}

console.log("\nFeestdagen (berekend per jaar, niet hardcoded)");
// Bekende ijkpunten, met de hand nagerekend.
const nl2026 = holidaysForYear(2026, "NL");
check("2026 Nieuwjaarsdag", nl2026.has("2026-01-01"));
check("2026 Goede Vrijdag = 3 april", nl2026.has("2026-04-03"));
check("2026 Tweede Paasdag = 6 april", nl2026.has("2026-04-06"));
check("2026 Koningsdag", nl2026.has("2026-04-27"));
check("2026 Hemelvaart = 14 mei", nl2026.has("2026-05-14"));
check("2026 Tweede Pinksterdag = 25 mei", nl2026.has("2026-05-25"));
check("2026 beide Kerstdagen", nl2026.has("2026-12-25") && nl2026.has("2026-12-26"));

const nl2027 = holidaysForYear(2027, "NL");
check("2027 is NIET leeg (de oude lijst stopte na 2026)", nl2027.size >= 8, `${nl2027.size} dagen`);
check("2027 Tweede Paasdag = 29 maart", nl2027.has("2027-03-29"));
check("2027 Hemelvaart = 6 mei", nl2027.has("2027-05-06"));

const nl2030 = holidaysForYear(2030, "NL");
check("2030 Tweede Paasdag = 22 april", nl2030.has("2030-04-22"));

const be2026 = holidaysForYear(2026, "BE");
check("BE 21 juli (nationale feestdag)", be2026.has("2026-07-21"));
check("BE kent geen Koningsdag", !be2026.has("2026-04-27"));
check("NL kent 21 juli niet als vrije dag", !nl2026.has("2026-07-21"));

check("filiaal 50 (Antwerpen) volgt de Belgische kalender", isHoliday("50", "2026-07-21"));
check("filiaal 99 (magazijn NL) niet", !isHoliday("99", "2026-07-21"));
check("extra sluitingsdag uit de instellingen telt mee", isHoliday("99", "2026-08-17", ["2026-08-17"]));

console.log("\nOpeningstijden uit content/stores.json");
const stores = getStores();
check("alle winkels hebben een stad en uren", stores.every((s) => s.city && s.hours));

// De bug die dit bestand moet bewaken: "gesloten" is tekst, geen tijdrange.
const dichtCellen: string[] = [];
for (const s of stores) {
  for (const d of DAYS) {
    const raw = (s.hours[d] || "").trim();
    if (raw && !/\d/.test(raw)) dichtCellen.push(`${s.city}/${d}="${raw}"`);
  }
}
check(
  `dagen met tekst i.p.v. tijden worden als DICHT gelezen (${dichtCellen.length} gevonden)`,
  dichtCellen.every((cel) => {
    const [stadDag] = cel.split("=");
    const [stad, dag] = stadDag.split("/");
    const store = stores.find((s) => s.city === stad);
    return store ? !isOpenOnDay(store.hours, dag) : false;
  }),
  dichtCellen.join(", "),
);

const hilversum = stores.find((s) => s.city === "Hilversum");
if (hilversum) {
  check("Hilversum maandag = dicht", !isOpenOnDay(hilversum.hours, "maandag"));
  check("Hilversum zondag = dicht", !isOpenOnDay(hilversum.hours, "zondag"));
  check("Hilversum dinsdag = open", isOpenOnDay(hilversum.hours, "dinsdag"));
}

console.log("\nSluitingsuur (basis voor de cutoff)");
const almere = stores.find((s) => s.city === "Almere");
if (almere) {
  const zat = closingHourOnDay(almere.hours, "zaterdag");
  check("Almere zaterdag heeft een sluitingsuur", zat != null && zat >= 12 && zat <= 22, String(zat));
}
check("een dichte dag geeft geen sluitingsuur", closingHourOnDay(hilversum?.hours, "maandag") === null);
check("onbekende uren geven null", closingHourOnDay(undefined, "maandag") === null);
// Naar beneden afronden: 17:30 mag geen cutoff van 18 opleveren.
check("17:30 → cutoff-uur 17", closingHourOnDay({ maandag: "10:00-17:30" }, "maandag") === 17);

console.log(fouten === 0 ? "\nAlles goed.\n" : `\n${fouten} fout(en).\n`);
process.exit(fouten === 0 ? 0 : 1);
