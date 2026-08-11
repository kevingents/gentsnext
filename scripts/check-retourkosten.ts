import "@/lib/load-env";
import { t } from "@/lib/messages";
import { LOCALES } from "@/lib/i18n";

/** Volgen de retourteksten het ingestelde bedrag, in elke taal? */
function main() {
  const proef = { days: 30, amount: "€ 7,94" };
  const sleutels = ["order.free_return", "mail.order.returnNote", "pdp.returns.freeNote", "retourneren.intro.part3"];
  let fout = 0;
  for (const key of sleutels) {
    console.log(`\n### ${key}`);
    for (const loc of LOCALES) {
      const uit = t(key, loc, proef);
      const heeftOud = /4[,.]99/.test(uit);
      const heeftNieuw = uit.includes("7,94");
      const gat = /\{(days|amount)\}/.test(uit);
      if (heeftOud || gat) fout++;
      console.log(`  ${loc}  ${heeftOud ? "!! OUD BEDRAG" : gat ? "!! PLAATSHOUDER BLIJFT STAAN" : heeftNieuw ? "ok" : "-- geen bedrag"}  ${uit.slice(0, 110)}`);
    }
  }
  console.log(`\n=== ${fout} problemen ===`);
  process.exit(fout ? 1 : 0);
}
main();
