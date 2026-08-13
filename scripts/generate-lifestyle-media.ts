import "@/lib/load-env";
import { generateMedia, type Slot } from "@/lib/media-generator";

/**
 * AI-sfeerbeelden per product. Thema's en camerastijlen komen uit de portal
 * (Presentatie → Beeldthema's); de merkregels en de kwaliteitsinstellingen uit
 * lib/media-themes en lib/media-generator. Dit script is enkel de CLI-schil —
 * de cron /api/cron/beeldgeneratie draait exact dezelfde functie.
 *
 * Voorheen stonden scène, licht en categorie hardgecodeerd in dit bestand
 * (MOODS/CAT/PHASES), draaide alles op FASHN's standaard 1k/auto en was er geen
 * vast merkgezicht. Dat is nu allemaal instelbaar respectievelijk aan.
 *
 *   npm run gen:lifestyle -- 40                       (40 producten, slot lifestyle)
 *   npm run gen:lifestyle -- 40 Overhemden            (één hoofdgroep)
 *   npm run gen:lifestyle -- 46 --mixmatch            (de pak-samenstellen-colberts)
 *   npm run gen:lifestyle -- 20 --slot=lifestyle2     (tweede sfeerbeeld-slot)
 *   npm run gen:lifestyle -- 5 only=slimfit --redo    (gericht overschrijven)
 *   npm run gen:lifestyle -- 40 --everyman            (geen vast merkgezicht, goedkoper)
 */
async function main() {
  const args = process.argv.slice(2);
  const limit = Math.max(1, Math.min(500, Number(args[0]) || 40));
  const slot = ((args.find((a) => a.startsWith("--slot=")) || "").slice(7) || "lifestyle") as Slot;
  const only = (args.find((a) => a.startsWith("only=")) || "").slice(5);
  const maxCredits = Number((args.find((a) => a.startsWith("--max-credits=")) || "").slice(14)) || undefined;
  // Positioneel argument 2 = hoofdgroep (alles wat geen vlag is).
  const hoofdgroep = args.slice(1).find((a) => !a.startsWith("-") && !a.startsWith("only="));

  const res = await generateMedia({
    limit,
    slot,
    hoofdgroep,
    only,
    maxCredits,
    mixMatchOnly: args.includes("--mixmatch"),
    redo: args.includes("--redo"),
    onlyNew: args.includes("--new"),
    includeVariants: args.includes("--variants"),
    useFaceReference: !args.includes("--everyman"),
    log: (line) => console.log(line),
  });

  console.log(
    `\n✓ ${res.done} beelden, ${res.skipped} overgeslagen, ${res.failed} mislukt — ` +
      `${res.creditsBefore - res.creditsAfter} credits gebruikt, ${res.creditsAfter} over (${res.stoppedBecause}).`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
